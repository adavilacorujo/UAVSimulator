// DOM elements
const localVideo = document.getElementById('local-video');
const connectBtn = document.getElementById('connect-btn');
const disconnectBtn = document.getElementById('disconnect-btn');
const simulationModeCheckbox = document.getElementById('simulation-mode');
const connectionStatus = document.getElementById('connection-status');
const messagesContainer = document.getElementById('messages-container');
const latitudeElement = document.getElementById('latitude');
const longitudeElement = document.getElementById('longitude');
const altitudeElement = document.getElementById('altitude');
const headingElement = document.getElementById('heading');
const speedElement = document.getElementById('speed');
const telemetrySourceIndicator = document.getElementById('telemetry-source-indicator');

// Configuration
const serverUrl = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? `http://${window.location.hostname}:3000`
  : window.location.origin;

// State
let socket = null;
let webrtcConnection = null;
let telemetryManager = null;
let localStream = null;
let isConnected = false;
let usingRealGeolocation = false;

// Add a system message to the messages container
function addMessage(message) {
  const messageElement = document.createElement('div');
  messageElement.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  messagesContainer.appendChild(messageElement);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Update UI with telemetry data
function updateTelemetryUI(data) {
  latitudeElement.textContent = data.latitude.toFixed(6);
  longitudeElement.textContent = data.longitude.toFixed(6);
  altitudeElement.textContent = data.altitude.toFixed(1);
  headingElement.textContent = data.heading.toFixed(1);
  speedElement.textContent = data.speed.toFixed(1);
  
  // Update UI based on whether we're using real geolocation or simulation
  if (data.source) {
    const isReal = data.source === 'geolocation';
    usingRealGeolocation = isReal;
    
    // Update telemetry source indicator
    if (telemetrySourceIndicator) {
      telemetrySourceIndicator.textContent = isReal ? 'REAL GPS' : 'SIMULATION';
      telemetrySourceIndicator.style.color = isReal ? '#27ae60' : '#e74c3c';
    }
    
    // Update telemetry info label to show data source
    const telemetryInfo = document.getElementById('telemetry-info');
    if (telemetryInfo) {
      if (isReal) {
        telemetryInfo.classList.remove('simulated');
        telemetryInfo.classList.add('real');
      } else {
        telemetryInfo.classList.remove('real');
        telemetryInfo.classList.add('simulated');
      }
    }
  }
}

// Check if mediaDevices is available and set up polyfill if needed
function checkMediaDevicesSupport() {
  // Check for insecure context
  if (window.location.protocol !== 'https:' && 
      window.location.hostname !== 'localhost' && 
      window.location.hostname !== '127.0.0.1') {
    addMessage('WARNING: Camera access requires HTTPS except on localhost.');
  }
  
  // First check if navigator.mediaDevices exists at all
  if (!navigator.mediaDevices) {
    navigator.mediaDevices = {};
    addMessage('Navigator.mediaDevices not found, trying legacy methods.');
  }
  
  // Check if getUserMedia is available directly
  if (!navigator.mediaDevices.getUserMedia) {
    // Try legacy methods
    const legacyGUM = navigator.getUserMedia || 
                      navigator.webkitGetUserMedia || 
                      navigator.mozGetUserMedia || 
                      navigator.msGetUserMedia;
    
    if (legacyGUM) {
      addMessage('Using legacy getUserMedia method.');
      navigator.mediaDevices.getUserMedia = function(constraints) {
        return new Promise(function(resolve, reject) {
          legacyGUM.call(navigator, constraints, resolve, reject);
        });
      };
      return true;
    } else {
      addMessage('No getUserMedia implementation found in this browser.');
      return false;
    }
  }
  
  return true;
}

// Validate that video stream is actually working
function validateVideoStream(stream) {
  if (!stream) {
    addMessage('Stream is null or undefined');
    return false;
  }
  
  const videoTracks = stream.getVideoTracks();
  
  if (!videoTracks || videoTracks.length === 0) {
    addMessage('No video tracks found in the stream');
    return false;
  }
  
  // Log information about video tracks to help diagnose issues
  videoTracks.forEach((track, index) => {
    addMessage(`Video track ${index}: ${track.label} (${track.enabled ? 'enabled' : 'disabled'}, ${track.muted ? 'muted' : 'unmuted'})`);
    
    // Check if track is actually active
    if (track.readyState !== 'live') {
      addMessage(`Warning: Video track ${index} is not live (${track.readyState})`);
    }
  });
  
  return true;
}

// Connect to the server and start streaming
async function connect() {
  try {
    // First check if media devices are supported
    if (!checkMediaDevicesSupport()) {
      addMessage('Media capture is not supported in this browser.');
      addMessage('You can still connect in simulation mode without video.');
      
      // Continue without camera access - this is important!
      // Just proceed with simulation only
    }
    
    // Reset telemetry source indicator
    if (telemetrySourceIndicator) {
      telemetrySourceIndicator.textContent = 'CONNECTING...';
      telemetrySourceIndicator.style.color = '#f39c12';
    }
    
    // Connect to signaling server
    socket = io(serverUrl);
    
    // Set up socket event handlers
    socket.on('connect', () => {
      console.log('[Drone] Connected to signaling server');
      addMessage('Connected to signaling server');
      socket.emit('register-role', 'drone');
    });
    
    socket.on('disconnect', () => {
      addMessage('Disconnected from signaling server');
      disconnect();
    });
    
    socket.on('force-disconnect', (reason) => {
      addMessage(`Forced disconnect: ${reason}`);
      disconnect();
    });
    
    // Initialize WebRTC and Telemetry
    console.log('[Drone] Initializing WebRTC and Telemetry');
    webrtcConnection = new WebRTCConnection(socket, false);
    telemetryManager = new TelemetryManager(socket);
    
    // Only try to access camera if getUserMedia is supported
    if (navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function') {
      try {
        // Access user media (camera)
        const constraints = {
          video: true,
          // {
            // facingMode: 'environment', // Use the back camera if available
            // width: { ideal: 1280 },
            // height: { ideal: 720 }
          // },
          audio: true
        };
        
        addMessage('Requesting camera access...');
        localStream = await navigator.mediaDevices.getUserMedia(constraints);
        addMessage(`Video dimensions: ${localVideo.videoWidth}x${localVideo.videoHeight}`);
        console.log('[Drone]Camera access granted');

        
        // Validate the video stream
        const isValidVideo = validateVideoStream(localStream);
        
        if (isValidVideo) {
          // Display video in the local preview
          localVideo.srcObject = localStream;
          console.log('localVideo.videoHeight', localVideo.videoHeight, 'localVideo.videoWidth', localVideo.videoWidth)
          // // Ensure video tracks are enabled and not muted
          // addMessage('Ensuring video tracks are enabled and ready to send...');
          // localStream.getVideoTracks().forEach(track => {
          //   // Explicitly enable the track
          //   track.enabled = true;
            
          //   // Log track info for debugging
          //   addMessage(`Video track: ${track.label}, enabled: ${track.enabled}, muted: ${track.muted}, readyState: ${track.readyState}`);
            
          //   // Add event listener for track-ended events
          //   track.onended = () => {
          //     addMessage(`Video track ended: ${track.label}`);
          //   };
            
          //   // Set content hint for better performance
          //   track.contentHint = 'motion';
          // });
          
          // Set up WebRTC with the local stream
          addMessage('Setting up WebRTC with local stream...');
          console.log('[Drone] Setting up WebRTC with local stream...');
          await webrtcConnection.setLocalStream(localStream);
          webrtcConnection.createDataChannel('telemetry');
        } else {
          addMessage('WARNING: Video stream obtained but validation failed');
          // Still try to use it, as partial streams might work
          localVideo.srcObject = localStream;
          console.log('localVideo.videoHeight', localVideo.videoHeight, 'localVideo.videoWidth', localVideo.videoWidth)
          await webrtcConnection.setLocalStream(localStream);
          webrtcConnection.createDataChannel('telemetry');
        }
      } catch (mediaError) {
        addMessage(`Camera access error: ${mediaError.name} - ${mediaError.message}`);
        console.error('Media error:', mediaError);
        
        // Continue without video if the user denies camera access
        // or if there's some other issue with the camera
        addMessage('Continuing without video stream');
      }
    } else {
      addMessage('Camera access not available in this browser');
      addMessage('Operating in telemetry-only mode');
    }
    
    // Set up telemetry callback to update UI and send via WebRTC data channel
    telemetryManager.onTelemetryUpdate((data) => {
      updateTelemetryUI(data);
      if (webrtcConnection && webrtcConnection.dataChannel && webrtcConnection.dataChannel.readyState === 'open') {
        webrtcConnection.sendDataChannelMessage(data);
      } else {
        console.warn('[Drone] WebRTC data channel not open or not available. Cannot send telemetry via WebRTC. Current state:', webrtcConnection && webrtcConnection.dataChannel ? webrtcConnection.dataChannel.readyState : 'No data channel');
      }
    });
    
    // Start telemetry - always try to use real geolocation first
    addMessage('Starting telemetry collection - always using real geolocation when available');
    const allowSimulationFallback = simulationModeCheckbox.checked;
    telemetryManager.startTelemetry(allowSimulationFallback);
    addMessage(`Telemetry started (simulation ${allowSimulationFallback ? 'enabled as fallback' : 'disabled'}`);
    
    // Update UI state
    isConnected = true;
    connectionStatus.textContent = 'Connected';
    connectionStatus.classList.add('connected');
    connectBtn.disabled = true;
    disconnectBtn.disabled = false;
    simulationModeCheckbox.disabled = true;
    
    addMessage('Drone is ready and streaming');
  } catch (error) {
    addMessage(`Error connecting: ${error.message}`);
    console.error('Connection error:', error);
    disconnect();
  }
}

// Disconnect from the server and stop streaming
function disconnect() {
  // Stop telemetry
  if (telemetryManager) {
    telemetryManager.stopTelemetry();
    telemetryManager = null;
  }
  
  // Clean up WebRTC
  if (webrtcConnection) {
    webrtcConnection.cleanup();
    webrtcConnection = null;
  }
  
  // Stop local stream
  if (localStream) {
    localStream.getTracks().forEach(track => {
      track.stop();
      addMessage(`Stopped track: ${track.kind} (${track.label})`);
    });
    localVideo.srcObject = null;
    localStream = null;
  }
  
  // Disconnect socket
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  
  // Update UI state
  isConnected = false;
  connectionStatus.textContent = 'Disconnected';
  connectionStatus.classList.remove('connected');
  connectBtn.disabled = false;
  disconnectBtn.disabled = true;
  simulationModeCheckbox.disabled = false;
  
  // Reset telemetry display
  latitudeElement.textContent = '--';
  longitudeElement.textContent = '--';
  altitudeElement.textContent = '--';
  headingElement.textContent = '--';
  speedElement.textContent = '--';
  
  // Reset telemetry info styling
  const telemetryInfo = document.getElementById('telemetry-info');
  if (telemetryInfo) {
    telemetryInfo.classList.remove('real', 'simulated');
  }
  
  // Reset telemetry source indicator
  if (telemetrySourceIndicator) {
    telemetrySourceIndicator.textContent = '--';
    telemetrySourceIndicator.style.color = '';
  }
  
  addMessage('Disconnected and stopped streaming');
}

// Event listeners
connectBtn.addEventListener('click', connect);
disconnectBtn.addEventListener('click', disconnect);

// Update simulation checkbox label to be more clear
window.addEventListener('DOMContentLoaded', () => {
  const simulationCheckboxLabel = document.querySelector('label[for="simulation-mode"]');
  if (simulationCheckboxLabel) {
    simulationCheckboxLabel.textContent = 'Allow Simulation Fallback';
  }
  
  // Add styles for real vs simulated telemetry
  const style = document.createElement('style');
  style.textContent = `
    .telemetry-info.real {
      border-left: 4px solid #27ae60;
    }
    .telemetry-info.simulated {
      border-left: 4px solid #e74c3c;
    }
  `;
  document.head.appendChild(style);
});

// Initial message
addMessage('Drone simulator initialized. Press Connect to start.');

// Add information about browser compatibility
addMessage(`Browser: ${navigator.userAgent}`);

// Check for geolocation support
if (navigator.geolocation) {
  addMessage('Geolocation is supported in this browser');
} else {
  addMessage('WARNING: Geolocation is NOT supported in this browser');
}

// Check if running in secure context
if (window.isSecureContext === false) {
  addMessage('WARNING: Running in insecure context. Camera and geolocation might not work.');
}

// Print protocol information
addMessage(`Protocol: ${window.location.protocol}`);

// Add information about HTTPS requirement
if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
  addMessage('WARNING: Camera and geolocation access requires HTTPS in most browsers. Your connection is insecure.');
} 