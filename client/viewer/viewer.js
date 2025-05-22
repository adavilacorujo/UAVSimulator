/* eslint-disable no-unused-vars */
// DOM elements
const remoteVideo = document.getElementById('remote-video');
const noSignalElement = document.getElementById('no-signal');
const connectionStatus = document.getElementById('connection-status');
const messagesContainer = document.getElementById('messages-container');
const latitudeElement = document.getElementById('latitude');
const longitudeElement = document.getElementById('longitude');
const altitudeElement = document.getElementById('altitude');
const headingElement = document.getElementById('heading');
const speedElement = document.getElementById('speed');
const lastUpdateElement = document.getElementById('last-update');

// Configuration
const serverUrl = window.location.protocol === 'https:'
  ? `https://${window.location.hostname}:${window.location.port || '3000'}`
  : (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? `http://${window.location.hostname}:3000`
    : window.location.origin;

// State
let socket = null;
let webrtcConnection = null;
let telemetryManager = null;
let map = null;
let droneMarker = null;
let droneHeadingElement = null;
let lastTelemetry = null;
let isDroneConnected = false;
let hasDroneVideo = false;
let flightPath = [];
let lastTelemetryReceived = 0; // Track when we last received telemetry
let videoCheckInterval = null;
let addedStream = false;

// Add a system message to the messages container
function addMessage(message) {
  const messageElement = document.createElement('div');
  messageElement.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  messagesContainer.appendChild(messageElement);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
  
  // Also log to console for debugging
  console.log(`[System] ${message}`);
}

// Debug video stream
function debugVideoElement() {
  // Check if video element has a valid source
  if (!remoteVideo.srcObject) {
    addMessage('Video element has no source stream');
    return false;
  }
  
  // Log video element state
  addMessage(`Video state: readyState=${remoteVideo.readyState}, paused=${remoteVideo.paused}, networkState=${remoteVideo.networkState}`);
  addMessage(`Video size: ${remoteVideo.videoWidth}x${remoteVideo.videoHeight}`);
  
  // Check tracks in the stream
  const stream = remoteVideo.srcObject;
  const videoTracks = stream.getVideoTracks();
  
  if (videoTracks.length === 0) {
    addMessage('Stream has no video tracks');
    return false;
  }
  
  // Log track information
  videoTracks.forEach((track, idx) => {
    addMessage(`Video track ${idx}: ${track.label} (enabled: ${track.enabled}, muted: ${track.muted}, state: ${track.readyState})`);
    
    // Get track constraints if available
    try {
      const settings = track.getSettings();
      addMessage(`Track settings: ${JSON.stringify(settings)}`);
    } catch (e) {
      addMessage('Could not get track settings');
    }
    
    // Check track capabilities
    try {
      const capabilities = track.getCapabilities ? track.getCapabilities() : 'Not supported';
      addMessage(`Track capabilities: ${JSON.stringify(capabilities)}`);
    } catch (e) {
      addMessage('Could not get track capabilities');
    }
  });
  
  return true;
}

// Attempt to fix video track issues
function fixVideoTracks() {
  if (!remoteVideo.srcObject) return false;
  
  const videoTracks = remoteVideo.srcObject.getVideoTracks();
  let fixed = false;
  
  videoTracks.forEach(track => {
    if (track.muted) {
      addMessage('Cannot unmute track programmatically due to browser security restrictions');
      // The muted state is controlled by the browser and can't be changed programmatically
      // The user needs to interact with the page to unmute
      // pendingUserInteraction = true;
    }
    
    if (!track.enabled) {
      track.enabled = true;
      addMessage(`Enabled previously disabled track: ${track.label}`);
      fixed = true;
    }
    
    // Check readyState
    if (track.readyState !== 'live') {
      addMessage(`Track not live: ${track.readyState}`);
    }
  });
  
  // Try restarting video playback
  // restartVideoPlayback();
  
  return fixed;
}

// Initialize the map
function initMap() {
  // Create a map centered on San Francisco (as a default)
  map = L.map('map').setView([37.7749, -122.4194], 13);
  
  // Add OpenStreetMap tile layer
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);
  
  addMessage('Map initialized');
}

// Create or update the drone marker on the map
function updateDroneMarker(data) {
  try {
    const { latitude, longitude, heading } = data;
    
    // Log telemetry data for debugging
    addMessage(`Updating drone marker with: lat=${latitude.toFixed(6)}, lon=${longitude.toFixed(6)}, heading=${heading.toFixed(1)}, source=${data.source || 'unknown'}`);
    
    if (!droneMarker) {
      // Create custom drone icon
      const droneIcon = L.divIcon({
        className: 'drone-icon',
        html: '<div class="drone-heading"><div class="drone-heading-arrow"></div></div>',
        iconSize: [30, 30]
      });
      
      // Create the marker
      droneMarker = L.marker([latitude, longitude], { icon: droneIcon }).addTo(map);
      droneHeadingElement = droneMarker.getElement().querySelector('.drone-heading');
      
      // Center the map on the drone's position
      map.setView([latitude, longitude], 15);
      
      // Start tracking the flight path
      flightPath = [[latitude, longitude]];
      
      // Create a polyline for the flight path
      droneMarker.flightPath = L.polyline(flightPath, {
        color: '#3498db',
        weight: 3,
        opacity: 0.7
      }).addTo(map);
    } else {
      // Update marker position
      droneMarker.setLatLng([latitude, longitude]);
      
      // Update flight path
      flightPath.push([latitude, longitude]);
      droneMarker.flightPath.setLatLngs(flightPath);
      
      // Keep only the last 100 points to avoid excessive memory usage
      if (flightPath.length > 100) {
        flightPath.shift();
      }
    }
    
    // Update heading indicator
    if (droneHeadingElement) {
      droneHeadingElement.style.transform = `rotate(${heading}deg)`;
    }
    
    // Update timestamp for telemetry monitoring
    lastTelemetryReceived = Date.now();
    
  } catch (error) {
    console.error('Error updating drone marker:', error);
    addMessage(`Error updating map: ${error.message}`);
  }
}

// Update UI with telemetry data
function updateTelemetryUI(data) {
  try {
    if (!data) {
      addMessage('Warning: Received undefined telemetry data');
      return;
    }
    
    // Store the telemetry data
    lastTelemetry = data;
    
    // Log the received telemetry for debugging
    console.log('Received telemetry:', data);
    
    // Update text display
    latitudeElement.textContent = data.latitude.toFixed(6);
    longitudeElement.textContent = data.longitude.toFixed(6);
    altitudeElement.textContent = data.altitude.toFixed(1) + ' m';
    headingElement.textContent = data.heading.toFixed(1) + ' °';
    speedElement.textContent = data.speed.toFixed(1) + ' m/s';
    lastUpdateElement.textContent = new Date().toLocaleTimeString();
    
    // Update map marker
    updateDroneMarker(data);
  } catch (error) {
    console.error('Error updating telemetry UI:', error);
    addMessage(`Error updating telemetry display: ${error.message}`);
  }
}

// Start periodic checking for video issues
function startVideoMonitoring() {
  // Clear any existing interval
  if (videoCheckInterval) {
    clearInterval(videoCheckInterval);
  }
  
  // Check video status every 3 seconds
  videoCheckInterval = setInterval(() => {
    if (remoteVideo.srcObject) {
      const stream = remoteVideo.srcObject;
      addMessage(`[VideoMonitor] Checking stream ${stream.id}. Active: ${stream.active}`);
      const videoTracks = stream.getVideoTracks();

      if (videoTracks.length > 0) {
        const track = videoTracks[0];
        addMessage(`[VideoMonitor] Track state: readyState=${track.readyState}, enabled=${track.enabled}, muted=${track.muted}`);
        if (track.readyState === 'live' && track.enabled && track.muted) {
          if (remoteVideo.videoWidth === 0 || remoteVideo.videoHeight === 0) {
            addMessage('[VideoMonitor] Video track is live and enabled, but dimensions are zero. Possible no actual video frames.');
          }
          if (remoteVideo.paused) {
            addMessage('[VideoMonitor] Video is live but paused, attempting to play.');
            remoteVideo.play().catch(e => addMessage(`[VideoMonitor] Error re-playing video: ${e.name} - ${e.message}`));
          }
        } else {
          addMessage('[VideoMonitor] Video track not in optimal state for playback.');
          // Optionally, try to fix tracks again if a fixVideoTracks function is robust
          // fixVideoTracks(); 
        }
      } else {
        addMessage('[VideoMonitor] Stream has no video tracks.');
      }
      // Update hasDroneVideo based on actual playback state
      hasDroneVideo = !remoteVideo.paused && stream.active;

    } else if (isDroneConnected) { // Removed !hasDroneVideo as it's implicitly covered by remoteVideo.srcObject being null
      addMessage('[VideoMonitor] Drone connected, but no remote stream assigned to video element.');
      // This state suggests the onTrack event might not have fired or failed to assign the stream
    }

    // Consolidate no-signal display logic
    if (hasDroneVideo) {
        noSignalElement.style.display = 'none';
    } else {
        noSignalElement.style.display = 'flex';
    }

  }, 3000);
}

// Initialize the viewer
function init() {
  // Set up the video element with attributes that improve autoplay chances
  remoteVideo.muted = true; // Initially muted to improve autoplay chances
  remoteVideo.playsInline = true; // Important for iOS
  remoteVideo.autoplay = true;
  
  // Connect to signaling server
  socket = io(serverUrl);
  
  // Set up socket event handlers
  socket.on('connect', () => {
    addMessage('Connected to signaling server');
    socket.emit('register-role', 'viewer');
  });
  
  socket.on('disconnect', () => {
    addMessage('Disconnected from signaling server');
    handleDroneDisconnect();
  });
  
  socket.on('drone-status', (status) => {
    isDroneConnected = status.connected;
    
    if (status.connected) {
      connectionStatus.textContent = 'Drone Connected';
      connectionStatus.className = 'status-indicator connected';
      addMessage('Drone has connected');
    } else {
      connectionStatus.textContent = 'Waiting for drone';
      connectionStatus.className = 'status-indicator';
      addMessage('Waiting for drone to connect');
      handleDroneDisconnect();
    }
  });
  
  // Handle possible WebRTC errors
  socket.on('webrtc-error', (error) => {
    addMessage(`WebRTC error from server: ${error.message || 'Unknown error'}`);
  });
  
  // Initialize WebRTC
  webrtcConnection = new WebRTCConnection(socket, true);
  
  // Set up WebRTC event handlers
  webrtcConnection.onTrack(async (event) => {
    console.log('[Viewer] Received video stream event:', event);
    addMessage(`[Viewer] onTrack event. Streams count: ${event.streams ? event.streams.length : 'N/A'}`);
    
    if (event.streams && event.streams[0]) {
      const stream = event.streams[0];
      addMessage(`[Viewer] Stream ID: ${stream.id}. Active: ${stream.active}. Tracks count: ${stream.getTracks().length}`);
      
      stream.getTracks().forEach((track, idx) => {
        addMessage(`[Viewer] Track ${idx}: kind=${track.kind}, label='${track.label}', enabled=${track.enabled}, muted=${track.muted}, readyState=${track.readyState}`);
        if (track.kind === 'video') {
          try {
            const settings = track.getSettings();
            addMessage(`[Viewer] Video Track ${idx} Settings: ${JSON.stringify(settings)} (w:${settings.width}, h:${settings.height}, fps:${settings.frameRate})`);
          } catch (e) {
            addMessage(`[Viewer] Could not get settings for track ${idx}: ${e.message}`);
          }
        }
        track.onunmute = () => addMessage(`[Viewer] Track ${idx} unmuted.`);
        track.onmute = () => addMessage(`[Viewer] Track ${idx} muted.`);
        track.onended = () => {
          addMessage(`[Viewer] Track ${idx} ended. ReadyState: ${track.readyState}`);
          hasDroneVideo = false; // Ensure this is updated if a track ends
        }
      });
      
      console.log('stream', stream);
      remoteVideo.srcObject = stream;
      remoteVideo.muted = true; // Ensure video is muted for autoplay policies
      addMessage(`[Viewer] Assigned stream ${stream.id} to remoteVideo element. Set to muted.`);
      noSignalElement.style.display = 'none'; // Explicitly hide no-signal overlay
      remoteVideo.style.border = '5px solid limegreen'; // Debug style
      remoteVideo.style.backgroundColor = 'black'; // Ensure contrast

      // Log video element state immediately after setting srcObject
      addMessage(`[Viewer] remoteVideo state: readyState=${remoteVideo.readyState}, networkState=${remoteVideo.networkState}, error=${remoteVideo.error ? remoteVideo.error.message : 'null'}`);
      addMessage(`[Viewer] remoteVideo dimensions (before play): ${remoteVideo.videoWidth}x${remoteVideo.videoHeight}`);

      remoteVideo.play().then(() => {
        addMessage('[Viewer] remoteVideo.play() attempt succeeded.');
        hasDroneVideo = true; // Tentatively set, will be refined by video monitor
        noSignalElement.style.display = 'none';
        remoteVideo.style.border = '2px solid green'; // Update border on successful play
        addMessage(`[Viewer] remoteVideo dimensions (after play success): ${remoteVideo.videoWidth}x${remoteVideo.videoHeight}`);
      }).catch(error => {
        addMessage(`[Viewer] Error calling remoteVideo.play(): ${error.name} - ${error.message}`);
        remoteVideo.style.border = '5px solid red'; // Update border on play failure
        hasDroneVideo = false;
      });

      startVideoMonitoring(); // Start monitoring video quality etc.

    } else {
      addMessage('[Viewer] onTrack event received, but no streams or stream[0] is undefined.');
      console.error('[Viewer] onTrack event issue:', event);
    }
    
    // Debug stream details
    console.log(`[Viewer] Stream has ${event.streams[0].getTracks().length} tracks`);
    addMessage(`[Viewer] Stream has ${event.streams[0].getTracks().length} tracks`);
    
    // Debug track information
    document.getElementById('remote-video').srcObject = event.streams[0];
    console.log('[Viewer] Remote video:', event.streams[0]);
    // remoteVideo.srcObject = event.streams[0];
    
    // remoteVideo.style.opacity = '1';
    // remoteVideo.style.width = '100%';
    // remoteVideo.style.height = '100%';
    // remoteVideo.style.backgroundColor = 'black';
    
    // // Force a style refresh to make sure video element is visible
    // setTimeout(() => {
    //   addMessage(`Video element size: ${remoteVideo.offsetWidth}x${remoteVideo.offsetHeight}`);
    //   addMessage(`Video element visible: ${window.getComputedStyle(remoteVideo).display !== 'none'}`);
      
    //   // Check if the video element is in the DOM
    //   addMessage(`Video element in DOM: ${document.body.contains(remoteVideo)}`);
      
    //   // Check if there are CSS styles hiding the video
    //   const videoStyle = window.getComputedStyle(remoteVideo);
    //   addMessage(`Video visibility: ${videoStyle.visibility}, opacity: ${videoStyle.opacity}`);
    // }, 1000);
    
    // Add additional event listeners to debug video issues
    // remoteVideo.onloadedmetadata = () => {
    //   addMessage(`Video dimensions: ${remoteVideo.videoWidth}x${remoteVideo.videoHeight}`);
    // };
    
    // remoteVideo.oncanplay = () => {
    //   addMessage("Video can play now");
    // };
    
    // remoteVideo.onplaying = () => {
    //   addMessage("Video is actually playing now");
    // };
    
    // remoteVideo.onstalled = () => {
    //   addMessage("Video playback has stalled");
    // };
    
    // remoteVideo.onwaiting = () => {
    //   addMessage("Video is waiting for more data");
    // };
    
    // remoteVideo.onplay = () => {
    //   addMessage('Video playback started');
    //   hasDroneVideo = true;
    //   noSignalElement.style.display = 'none';
      
    //   // If autoplay worked, we can try to unmute after a short delay
    //   // This needs to happen after play has started from user interaction
    //   setTimeout(() => {
    //     if (!remoteVideo.muted && document.getElementById('play-video-button')) {
    //       document.getElementById('play-video-button').remove();
    //     }
    //   }, 1000);
    // };
    
    // remoteVideo.onpause = () => {
    //   addMessage('Video playback paused');
    // };
    
    // remoteVideo.onerror = (e) => {
    //   addMessage(`Video error: ${e.message || 'Unknown error'}`);
    // };
    
    // Start monitoring for video issues
    
    // Force video to play
    // remoteVideo.play().then(() => {
    //   addMessage('Playback started successfully');
      
    //   // After 2 seconds try to unmute if the page has had user interaction
    //   setTimeout(() => {
    //     if (hasUserInteraction()) {
    //       remoteVideo.muted = false;
    //       addMessage('Unmuted video after successful autoplay');
    //     }
        
    //     // Check if we actually have video data
    //     checkVideoHasRealContent();
    //   }, 2000);
    // }).catch(error => {
    //   addMessage(`Error starting playback: ${error.message}`);
    //   // Try to debug what's wrong
    //   debugVideoElement();
      
    //   // Provide a visual play button for user interaction
    //   restartVideoPlayback();
    // });
  })
  
  webrtcConnection.onDataChannelMessage((data) => {
    // Handle data channel messages if needed
    console.log('[Viewer] Received data channel message:', data);
    
    // If message contains telemetry data, process it
    if (data && typeof data === 'object' && 'latitude' in data && 'longitude' in data) {
      addMessage('[Viewer] Received telemetry via data channel');
      updateTelemetryUI(data);
    }
  });
  
  // Initialize telemetry manager
  telemetryManager = new TelemetryManager(socket);
  
  // Initialize the map
  initMap();
  
  addMessage('Viewer initialized, waiting for drone connection');
  
  // Add browser information for debugging
  addMessage(`Browser: ${navigator.userAgent}`);
  
  // Check for WebRTC support
  if (typeof RTCPeerConnection !== 'undefined') {
    addMessage('WebRTC is supported in this browser');
  } else {
    addMessage('WARNING: WebRTC is not supported in this browser');
  }
  
  // Check for secure context
  if (window.isSecureContext === false) {
    addMessage('WARNING: Running in insecure context. WebRTC might be restricted.');
  }
  
  // Monitor video and telemetry status periodically
  setInterval(() => {
    // Check if telemetry is still coming in
    const now = Date.now();
    if (lastTelemetryReceived > 0 && now - lastTelemetryReceived > 10000) {
      addMessage('WARNING: No telemetry received in the last 10 seconds');
      // Reset to avoid repeated warnings
      lastTelemetryReceived = 0;
    }
  }, 5000);
  
  // Set up user interaction detection - REMOVING
  // setupUserInteractionDetection();
}

// Detect if the page has had user interaction - REMOVING
/*
let hadUserInteraction = false;
function hasUserInteraction() {
  return hadUserInteraction;
}
*/

// Set up detection of user interaction with the page - REMOVING
/*
function setupUserInteractionDetection() {
  const interactionEvents = ['click', 'touchend', 'keydown'];
  
  interactionEvents.forEach(eventType => {
    document.addEventListener(eventType, () => {
      hadUserInteraction = true;
      
      // If we were waiting for user interaction to play video
      if (pendingUserInteraction && remoteVideo.srcObject) { // pendingUserInteraction is removed
        remoteVideo.play().catch(err => {
          addMessage(`Still failed to play after user interaction: ${err.message}`);
        });
        
        // Try to unmute
        remoteVideo.muted = false;
        // pendingUserInteraction = false; // removed
      }
    }, { once: false }); // Allow multiple triggers
  });
}
*/

// Handle drone disconnect
function handleDroneDisconnect() {
  // Hide video and show no signal overlay
  if (hasDroneVideo) {
    // Keep the last frame visible but show the overlay
    noSignalElement.style.display = 'flex';
    hasDroneVideo = false;
    
    // Debug current video state
    debugVideoElement();
  }
  
  // Update status
  isDroneConnected = false;
  connectionStatus.textContent = 'Drone Disconnected';
  connectionStatus.className = 'status-indicator disconnected';
}

// Initialize the viewer when the page loads
window.addEventListener('load', init);

// Add buttons to help debug video and telemetry issues
// function addDebugButtons() {
//   // Video debug button
//   const videoDebugButton = document.createElement('button');
//   videoDebugButton.textContent = 'Debug Video';
//   videoDebugButton.style.position = 'absolute';
//   videoDebugButton.style.bottom = '10px';
//   videoDebugButton.style.right = '10px';
//   videoDebugButton.style.zIndex = '1000';
//   videoDebugButton.style.padding = '8px';
//   videoDebugButton.style.backgroundColor = '#3498db';
//   videoDebugButton.style.color = 'white';
//   videoDebugButton.style.border = 'none';
//   videoDebugButton.style.borderRadius = '4px';
//   videoDebugButton.addEventListener('click', () => {
//     debugVideoElement();
//     fixVideoTracks();
//     restartVideoPlayback();
//   });
  
//   // Telemetry debug button
//   const telemetryDebugButton = document.createElement('button');
//   telemetryDebugButton.textContent = 'Debug Telemetry';
//   telemetryDebugButton.style.position = 'absolute';
//   telemetryDebugButton.style.bottom = '10px';
//   telemetryDebugButton.style.right = '100px';
//   telemetryDebugButton.style.zIndex = '1000';
//   telemetryDebugButton.style.padding = '8px';
//   telemetryDebugButton.style.backgroundColor = '#2ecc71';
//   telemetryDebugButton.style.color = 'white';
//   telemetryDebugButton.style.border = 'none';
//   telemetryDebugButton.style.borderRadius = '4px';
//   telemetryDebugButton.addEventListener('click', () => {
//     addMessage('Telemetry debug info:');
//     if (lastTelemetry) {
//       addMessage(`Last telemetry: ${JSON.stringify(lastTelemetry)}`);
//       addMessage(`Last update: ${new Date(lastTelemetryReceived).toLocaleTimeString()}`);
//     } else {
//       addMessage('No telemetry data received yet');
//     }
    
//     // If we have telemetry data but it's not showing on the map, try updating again
//     if (lastTelemetry) {
//       updateDroneMarker(lastTelemetry);
//     }
//   });
  
//   // Explicit play button
//   const playVideoButton = document.createElement('button');
//   playVideoButton.textContent = 'Play Video';
//   playVideoButton.style.position = 'absolute';
//   playVideoButton.style.bottom = '10px';
//   playVideoButton.style.right = '220px';
//   playVideoButton.style.zIndex = '1000';
//   playVideoButton.style.padding = '8px';
//   playVideoButton.style.backgroundColor = '#e74c3c';
//   playVideoButton.style.color = 'white';
//   playVideoButton.style.border = 'none';
//   playVideoButton.style.borderRadius = '4px';
//   playVideoButton.addEventListener('click', () => {
//     if (remoteVideo.srcObject) {
//       addMessage('Attempting to play video (user-initiated)');
//       // This click should trigger our user interaction detection
//       remoteVideo.muted = false;
//       remoteVideo.play().then(() => {
//         addMessage('Video playback started successfully (user-initiated)');
//         if (document.getElementById('play-video-button')) {
//           document.getElementById('play-video-button').remove();
//         }
//       }).catch(e => {
//         addMessage(`Error playing video: ${e.message}`);
//       });
      
//       // Consider this user interaction
//       hadUserInteraction = true;
//       pendingUserInteraction = false;
//     } else {
//       addMessage('No video stream available to play');
//     }
//   });
  
//   // Unmute button
//   const unmuteButton = document.createElement('button');
//   unmuteButton.textContent = 'Unmute Video';
//   unmuteButton.style.position = 'absolute';
//   unmuteButton.style.bottom = '10px';
//   unmuteButton.style.right = '310px';
//   unmuteButton.style.zIndex = '1000';
//   unmuteButton.style.padding = '8px';
//   unmuteButton.style.backgroundColor = '#9b59b6';
//   unmuteButton.style.color = 'white';
//   unmuteButton.style.border = 'none';
//   unmuteButton.style.borderRadius = '4px';
//   unmuteButton.addEventListener('click', () => {
//     remoteVideo.muted = false;
//     addMessage('Video unmuted (user-initiated)');
//     hadUserInteraction = true;
//   });
  
//   // Add buttons to the DOM
//   document.body.appendChild(videoDebugButton);
//   document.body.appendChild(telemetryDebugButton);
//   document.body.appendChild(playVideoButton);
//   document.body.appendChild(unmuteButton);
// }

// Add debug buttons
// addDebugButtons();

// Function to check if video element has actual content
function checkVideoHasRealContent() {
  if (!remoteVideo.srcObject || !remoteVideo.videoWidth || !remoteVideo.videoHeight) {
    addMessage('WARNING: Video element has no real content. Ensure stream is active and video element is correctly configured.');
  } else {
    addMessage(`Video has real content: ${remoteVideo.videoWidth}x${remoteVideo.videoHeight}`);
  }
} 