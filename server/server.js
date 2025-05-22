const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../client')));

// Add a health check endpoint
app.get('/health', (req, res) => {
  res.status(200).send('Server is running');
});

// Add an index page that redirects to the viewer by default
app.get('/', (req, res) => {
  res.redirect('/viewer/');
});

const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Store connected clients
const viewers = new Set();
let droneSocket = null;
let lastTelemetry = null;
let telemetryCount = 0;

// Debugging functions
function logInfo(message) {
  console.log(`[INFO] ${message}`);
}

function logError(message, error) {
  console.error(`[ERROR] ${message}`, error);
}

function logWebRTC(message) {
  console.log(`[WebRTC] ${message}`);
}

function logTelemetry(data, fromDrone = true) {
  if (fromDrone) {
    telemetryCount++;
    // Only log every 10th telemetry message to avoid console flood
    if (telemetryCount % 10 === 0) {
      console.log(`[TELEMETRY] #${telemetryCount} - Received from drone: lat=${data.latitude.toFixed(6)}, lon=${data.longitude.toFixed(6)}, heading=${data.heading.toFixed(1)}, source=${data.source || 'unknown'}`);
    }
  }
}

io.on('connection', (socket) => {
  logInfo(`New client connected: ${socket.id}`);

  socket.on('register-role', (role) => {
    try {
      if (role === 'drone') {
        // If another drone was connected, disconnect it
        if (droneSocket) {
          logInfo(`Forcing disconnect of previous drone: ${droneSocket.id}`);
          io.to(droneSocket.id).emit('force-disconnect', 'Another drone has connected');
        }
        droneSocket = socket;
        logInfo(`Drone registered: ${socket.id}`);
        
        // Inform viewers that a drone is connected
        for (const viewer of viewers) {
          io.to(viewer.id).emit('drone-status', { connected: true });
        }
        
        // If we have cached telemetry, send it to the new drone
        if (lastTelemetry) {
          logInfo('Sending cached telemetry to new drone');
          socket.emit('telemetry', lastTelemetry);
        }
      } else if (role === 'viewer') {
        viewers.add(socket);
        logInfo(`Viewer registered: ${socket.id}, Total viewers: ${viewers.size}`);
        
        // Inform new viewer about drone status
        socket.emit('drone-status', { connected: !!droneSocket });
        
        // If we have cached telemetry, send it to the new viewer
        if (lastTelemetry) {
          logInfo('Sending cached telemetry to new viewer');
          socket.emit('telemetry', lastTelemetry);
        }
      } else {
        console.warn(`Unknown role requested: ${role}`);
        socket.emit('error', { message: 'Unknown role' });
      }
    } catch (error) {
      logError('Error in register-role handler:', error);
    }
  });

  // Handle WebRTC signaling for perfect negotiation
  socket.on('signal', (data) => {
    try {
      logWebRTC(`Received 'signal' event from ${socket.id} with data: ${JSON.stringify(data)}`);
      const { description, candidate } = data;

      if (socket === droneSocket) {
        // Signal from Drone: Relay to all viewers
        if (viewers.size > 0) {
          logWebRTC(`Drone ${socket.id} signaling to ${viewers.size} viewers.`);
          for (const viewer of viewers) {
            // Add senderSocketId to prevent viewer from processing its own echo if server broadcasts back
            io.to(viewer.id).emit('signal', { ...data, senderSocketId: droneSocket.id });
          }
        } else {
          logWebRTC(`Drone ${socket.id} sent a signal, but no viewers are connected.`);
        }
      } else if (viewers.has(socket)) {
        // Signal from Viewer: Relay to Drone
        if (droneSocket) {
          logWebRTC(`Viewer ${socket.id} signaling to Drone ${droneSocket.id}.`);
          // Add senderSocketId to prevent drone from processing its own echo
          io.to(droneSocket.id).emit('signal', { ...data, senderSocketId: socket.id });
        } else {
          logWebRTC(`Viewer ${socket.id} sent a signal, but drone is not connected.`);
          socket.emit('webrtc-error', { message: 'Drone not connected to relay signal.' });
        }
      } else {
        logWebRTC(`Received signal from unknown socket: ${socket.id}`);
      }
    } catch (error) {
      logError('Error in "signal" handler:', error);
      socket.emit('webrtc-error', { message: 'Server error processing signal: ' + error.message });
    }
  });

  // Handle telemetry data
  socket.on('telemetry', (data) => {
    try {
      if (socket === droneSocket) {
        // Cache the latest telemetry
        lastTelemetry = data;
        
        // Log telemetry for debugging
        logTelemetry(data);
        
        // Broadcast telemetry to all viewers
        if (viewers.size > 0) {
          for (const viewer of viewers) {
            io.to(viewer.id).emit('telemetry', data);
          }
          
          // Log every 50th telemetry broadcast to avoid console flood
          if (telemetryCount % 50 === 0) {
            logInfo(`Broadcast telemetry #${telemetryCount} to ${viewers.size} viewers`);
          }
        } else {
          // Only log lack of viewers occasionally
          if (telemetryCount % 50 === 0) {
            logInfo('No viewers connected to receive telemetry');
          }
        }
      } else if (viewers.has(socket)) {
        logInfo(`Received unexpected telemetry from viewer ${socket.id}`);
      }
    } catch (error) {
      logError('Error in telemetry handler:', error);
    }
  });

  socket.on('disconnect', () => {
    try {
      logInfo(`Client disconnected: ${socket.id}`);
      
      if (socket === droneSocket) {
        droneSocket = null;
        for (const viewer of viewers) {
          io.to(viewer.id).emit('drone-status', { connected: false });
        }
        logInfo('Drone disconnected');
      } else if (viewers.has(socket)) {
        viewers.delete(socket);
        logInfo(`Viewer disconnected, total viewers: ${viewers.size}`);
      }
    } catch (error) {
      logError('Error in disconnect handler:', error);
    }
  });

  // Handle errors
  socket.on('error', (error) => {
    logError('Socket error:', error);
  });
});

// Periodically report stats
setInterval(() => {
  const stats = {
    viewers: viewers.size,
    droneConnected: !!droneSocket,
    telemetryCount: telemetryCount,
    lastTelemetry: lastTelemetry ? {
      latitude: lastTelemetry.latitude.toFixed(6),
      longitude: lastTelemetry.longitude.toFixed(6),
      timestamp: new Date(lastTelemetry.timestamp).toLocaleTimeString(),
      source: lastTelemetry.source || 'unknown'
    } : null
  };
  
  console.log(`[STATS] ${JSON.stringify(stats)}`);
}, 30000);

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`\n=== UAV Browser Simulator Server ===`);
  console.log(`Server running on port ${PORT}`);
  console.log(`- Drone UI: http://localhost:${PORT}/drone/`);
  console.log(`- Viewer UI: http://localhost:${PORT}/viewer/`);
  console.log(`\nIMPORTANT: For production use, configure HTTPS to ensure camera and geolocation access works properly.`);
  console.log(`=================================\n`);
}); 