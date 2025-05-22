# UAV Browser Simulator Project Structure

```
uav-browser-simulator/
├── README.md              # Project documentation
├── STRUCTURE.md           # This file explaining the structure
├── package.json           # Root package.json with utility scripts
├── server/                # Signaling server
│   ├── package.json       # Server dependencies
│   └── server.js          # Express and Socket.io server implementation
├── client/                # Client application
│   ├── js/                # Shared JavaScript utilities
│   │   ├── webrtc-utils.js    # WebRTC connection management
│   │   └── telemetry-utils.js # Telemetry data handling
│   ├── drone/             # Drone interface (for mobile)
│   │   ├── index.html     # Drone UI
│   │   ├── styles.css     # Drone UI styling
│   │   └── drone.js       # Drone functionality
│   └── viewer/            # Viewer interface (ground control)
│       ├── index.html     # Viewer UI
│       ├── styles.css     # Viewer UI styling
│       └── viewer.js      # Viewer functionality
```

## Component Descriptions

### Server

The server component contains a Node.js application that handles WebRTC signaling and telemetry distribution using Socket.io.

- **server.js**: Main server implementation handling client connections, WebRTC signaling, and telemetry broadcasting.

### Client

The client component is divided into shared utilities and two interfaces: drone and viewer.

#### Shared JavaScript (client/js/)

- **webrtc-utils.js**: Manages WebRTC connections, including offer/answer exchange, ICE candidate handling, and media stream setup.
- **telemetry-utils.js**: Handles telemetry data collection, simulation, and transmission.

#### Drone Interface (client/drone/)

The drone interface is designed to run on a mobile device to capture camera feed and telemetry data.

- **index.html**: User interface with video preview and controls.
- **styles.css**: Mobile-friendly styling for the drone interface.
- **drone.js**: Implements the drone functionality, including camera access, telemetry collection, and data transmission.

#### Viewer Interface (client/viewer/)

The viewer interface displays the drone's video feed and telemetry data on a map.

- **index.html**: User interface with video display, telemetry readouts, and map.
- **styles.css**: Styling for the viewer interface.
- **viewer.js**: Implements the viewer functionality, including video display, telemetry visualization, and map updates. 