# UAV Browser Simulator

A browser-based drone simulation system that uses WebRTC and WebSockets to stream video and telemetry data from a mobile browser (acting as a UAV) to viewer browsers (acting as ground control stations).

## Features

- Mobile browser acts as a UAV camera and telemetry source
- Real-time video streaming from mobile camera using WebRTC
- Live telemetry data (GPS, altitude, heading, etc.)
- Signaling server to coordinate WebRTC connections
- Viewer interface with live video and map display
- Flight path tracking on the map

## System Architecture

1. **Signaling Server**: Node.js server using Express and Socket.io
2. **Drone Client**: Mobile browser interface that captures video and telemetry
3. **Viewer Client**: Browser interface that displays video feed and telemetry on a map

## Setup and Installation

### Prerequisites

- Node.js (v14 or higher)
- npm (v6 or higher)
- Modern web browsers that support WebRTC (Chrome, Firefox, Safari)

### Installation

1. Clone this repository
2. Install server dependencies:

```bash
cd uav-browser-simulator/server
npm install
```

### Running the Application

1. Start the signaling server:

```bash
cd uav-browser-simulator/server
npm start
```

The server will start on port 3000 by default.

2. Access the Drone UI:
   - Open `http://YOUR_SERVER_IP:3000/drone/` in a mobile browser
   - Allow camera access when prompted
   - Click "Connect" to start streaming

3. Access the Viewer UI:
   - Open `http://YOUR_SERVER_IP:3000/viewer/` in any browser
   - Wait for the drone to connect
   - Once connected, you should see the video feed and telemetry data

## Usage Tips

- For best results, use the drone interface on a mobile device with GPS capability
- You can use simulation mode if GPS is not available
- Multiple viewers can connect to a single drone
- The flight path is displayed on the map, showing the drone's route

## Technologies Used

- WebRTC for real-time video streaming
- WebSockets (Socket.io) for signaling and telemetry
- Leaflet.js for map visualization
- HTML5 Geolocation API for acquiring position data
- Modern CSS with responsive design

## Security Considerations

This is a simulation system for educational purposes. In a production environment, you would need to:

- Implement secure authentication
- Use HTTPS for all connections
- Add TURN servers for NAT traversal
- Implement proper error handling and reconnection logic

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request. 