/**
 * WebRTC utility functions for the UAV browser simulator
 * Implements the "perfect negotiation" pattern.
 */

class WebRTCConnection {
  constructor(socket, polite = false) { // polite: true for viewer, false for drone (impolite)
    this.socket = socket;
    this.polite = polite;
    this.peerConnection = null;
    this.localStream = null;
    this.dataChannel = null; // For a single 1:1 data channel
    this.onTrackCallback = null;
    this.onDataChannelMessageCallback = null;

    // State for perfect negotiation
    this.makingOffer = false;
    this.ignoreOffer = false;
    this.isSettingRemoteAnswerPending = false; // Tracks if we are in the middle of setRemoteDescription(answer)
    
    this.peerConnectionConfig = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    };

    this._setupPeerConnection();
    this._setupSocketListeners();
  }

  _setupPeerConnection() {
    this.peerConnection = new RTCPeerConnection(this.peerConnectionConfig);

    // Handle ICE candidates
    this.peerConnection.onicecandidate = ({ candidate }) => {
      if (candidate) {
        console.log(`[WebRTC-${this._logPrefix()}] Sending ICE candidate:`, candidate);
        this.socket.emit('signal', { candidate });
      }
    };

    this.peerConnection.onicecandidateerror = (event) => {
      console.error(`[WebRTC-${this._logPrefix()}] ICE candidate error:`, event);
    };

    // Handle incoming tracks
    this.peerConnection.ontrack = (event) => {
      console.log(`[WebRTC-${this._logPrefix()}] Received track:`, event.track.kind, 'streams:', event.streams.length);
      if (this.onTrackCallback) {
        // Pass the first stream, as typically tracks are associated with one stream in this context
        this.onTrackCallback(event);
      }
    };

    // Handle data channels (if the remote peer creates one)
    this.peerConnection.ondatachannel = (event) => {
      console.log(`[WebRTC-${this._logPrefix()}] Received data channel:`, event.channel.label);
      this.dataChannel = event.channel;
      this._setupDataChannelEvents(this.dataChannel);
    };

    // Perfect negotiation: listen for negotiationneeded event
    this.peerConnection.onnegotiationneeded = async () => {
      try {
        console.log(`[WebRTC-${this._logPrefix()}] negotiationneeded event fired.`);
        this.makingOffer = true;
        await this.peerConnection.setLocalDescription(); // Automatically creates offer
        console.log(`[WebRTC-${this._logPrefix()}] Local description (offer) set:`, this.peerConnection.localDescription.type);
        this.socket.emit('signal', { description: this.peerConnection.localDescription });
      } catch (err) {
        console.error(`[WebRTC-${this._logPrefix()}] Error during negotiationneeded:`, err);
      } finally {
        this.makingOffer = false;
      }
    };

    this.peerConnection.oniceconnectionstatechange = () => {
      console.log(`[WebRTC-${this._logPrefix()}] ICE connection state: ${this.peerConnection.iceConnectionState}`);
      if (this.peerConnection.iceConnectionState === 'failed' || this.peerConnection.iceConnectionState === 'disconnected') {
        // Potentially attempt ICE restart here if needed, or notify application
        console.warn(`[WebRTC-${this._logPrefix()}] ICE connection problematic: ${this.peerConnection.iceConnectionState}`);
      }
    };
    
    this.peerConnection.onsignalingstatechange = () => {
      console.log(`[WebRTC-${this._logPrefix()}] Signaling state: ${this.peerConnection.signalingState}`);
    };
  }
  
  _logPrefix() {
    return this.polite ? 'PolitePeer' : 'ImpolitePeer';
  }

  _setupDataChannelEvents(channel) {
    channel.onopen = () => console.log(`[WebRTC-${this._logPrefix()}] Data channel '${channel.label}' opened.`);
    channel.onclose = () => console.log(`[WebRTC-${this._logPrefix()}] Data channel '${channel.label}' closed.`);
    channel.onmessage = (event) => {
      if (this.onDataChannelMessageCallback) {
        try {
          const data = JSON.parse(event.data);
          this.onDataChannelMessageCallback(data);
        } catch (e) {
          console.error(`[WebRTC-${this._logPrefix()}] Error parsing data channel message:`, e);
        }
      }
    };
    channel.onerror = (error) => console.error(`[WebRTC-${this._logPrefix()}] Data channel error:`, error);
  }
  
  createDataChannel(label = 'dataChannel', options = {}) {
    if (this.peerConnection && !this.dataChannel) { // Create only if not already existing from remote
      try {
        console.log(`[WebRTC-${this._logPrefix()}] Creating data channel: ${label}`);
        this.dataChannel = this.peerConnection.createDataChannel(label, options);
        this._setupDataChannelEvents(this.dataChannel);
      } catch (e) {
        console.error(`[WebRTC-${this._logPrefix()}] Error creating data channel:`, e);
      }
    } else {
      console.warn(`[WebRTC-${this._logPrefix()}] Data channel '${this.dataChannel ? this.dataChannel.label : ''}' already exists or peer connection not ready.`);
    }
  }
  
  /**
   * Set up WebRTC with the local media stream
   * @param {MediaStream} stream - The local media stream (optional)
   */
  async setLocalStream(stream) {
    try {
      console.log(`[WebRTC-${this._logPrefix()}] Setting local stream:`, stream ? `Stream with ${stream.getTracks().length} tracks` : 'No stream provided');
      if (!this.peerConnection) {
        console.error(`[WebRTC-${this._logPrefix()}] PeerConnection not initialized.`);
        return;
      }

      if (this.localStream) { // Remove old tracks before adding new ones
        this.localStream.getTracks().forEach(track => {
          const sender = this.peerConnection.getSenders().find(s => s.track === track);
          if (sender) {
            this.peerConnection.removeTrack(sender);
            console.log(`[WebRTC-${this._logPrefix()}] Removed old track: ${track.kind}`);
          }
        });
      }
      
      this.localStream = stream;

      if (stream) {
        stream.getTracks().forEach(track => {
          try {
            track.enabled = true; // Ensure tracks are enabled
            this.peerConnection.addTrack(track, stream);
            console.log(`[WebRTC-${this._logPrefix()}] Added track: ${track.kind} (${track.label})`);
          } catch (e) {
            console.error(`[WebRTC-${this._logPrefix()}] Error adding track:`, e);
          }
        });
      }
      // Note: onnegotiationneeded will be triggered automatically if tracks are added/removed.
    } catch (error) {
      console.error(`[WebRTC-${this._logPrefix()}] Error in setLocalStream:`, error);
    }
  }
  
  onTrack(callback) {
    this.onTrackCallback = callback;
  }
  
  onDataChannelMessage(callback) {
    this.onDataChannelMessageCallback = callback;
  }
  
  sendDataChannelMessage(message) {
    try {
      const data = JSON.stringify(message);
      if (this.dataChannel && this.dataChannel.readyState === 'open') {
        this.dataChannel.send(data);
      } else {
        console.warn(`[WebRTC-${this._logPrefix()}] Data channel not open or not available for sending message.`);
      }
    } catch (error) {
      console.error(`[WebRTC-${this._logPrefix()}] Error sending data channel message:`, error);
    }
  }

  _createIceCandidate(candidateData) {
    try {
      // If candidateData is null or undefined, return null
      if (!candidateData) {
        console.warn(`[WebRTC-${this._logPrefix()}] Received null or undefined candidate data`);
        return null;
      }
      
      if (candidateData instanceof RTCIceCandidate) {
        return candidateData;
      }
      
      const iceCandidateInit = {
        candidate: candidateData.candidate || '',
        sdpMid: candidateData.sdpMid || null,
        sdpMLineIndex: candidateData.sdpMLineIndex !== undefined ? candidateData.sdpMLineIndex : 0,
        usernameFragment: candidateData.usernameFragment || null
      };
      
      return new RTCIceCandidate(iceCandidateInit);
    } catch (error) {
      console.error(`[WebRTC-${this._logPrefix()}] Error creating ICE candidate:`, error, candidateData);
      return null;
    }
  }
  
  /**
   * Set up socket listeners for WebRTC signaling using a generic 'signal' event.
   */
  _setupSocketListeners() {
    this.socket.on('signal', async ({ description, candidate, senderSocketId }) => {
      // Ensure we're not processing signals from ourselves in a loopback scenario (if senderSocketId is provided by server)
      if (senderSocketId && senderSocketId === this.socket.id) {
        console.log(`[WebRTC-${this._logPrefix()}] Ignoring signal from self.`);
        return;
      }

      try {
        if (description) {
          console.log(`[WebRTC-${this._logPrefix()}] Received description:`, description.type, 'current signalingState:', this.peerConnection.signalingState);

          const offerCollision = description.type === 'offer' &&
                               (this.makingOffer || this.peerConnection.signalingState !== 'stable');

          this.ignoreOffer = !this.polite && offerCollision;
          if (this.ignoreOffer) {
            console.log(`[WebRTC-${this._logPrefix()}] Impolite peer ignoring incoming offer due to collision.`);
            return;
          }
          
          // Abort any pending setRemoteDescription if we receive an offer.
          if (this.isSettingRemoteAnswerPending && description.type === 'offer') {
            console.warn(`[WebRTC-${this._logPrefix()}] Received offer while an answer operation was pending. Aborting previous operation.`);
            this.isSettingRemoteAnswerPending = false; 
            // Potentially more cleanup might be needed here depending on the exact state.
          }

          await this.peerConnection.setRemoteDescription(description);
          console.log(`[WebRTC-${this._logPrefix()}] Remote description (${description.type}) set.`);

          // Process any pending ICE candidates now that remote description is set
          if (this.pendingIceCandidates && this.pendingIceCandidates.length > 0) {
            console.log(`[WebRTC-${this._logPrefix()}] Processing ${this.pendingIceCandidates.length} queued ICE candidates.`);
            for (const cand of this.pendingIceCandidates) {
              try {
                await this.peerConnection.addIceCandidate(cand);
                console.log(`[WebRTC-${this._logPrefix()}] Added queued ICE candidate.`);
              } catch (err) {
                console.error(`[WebRTC-${this._logPrefix()}] Error adding queued ICE candidate:`, err);
              }
            }
            this.pendingIceCandidates = []; // Clear the queue
          }

          if (description.type === 'offer') {
            await this.peerConnection.setLocalDescription(); // Automatically creates answer
            console.log(`[WebRTC-${this._logPrefix()}] Local description (answer) set:`, this.peerConnection.localDescription.type);
            this.socket.emit('signal', { description: this.peerConnection.localDescription });
          } else if (description.type === 'answer') {
            // Answer applied. Negotiation is complete for this round.
            console.log(`[WebRTC-${this._logPrefix()}] Answer applied. Signaling state: ${this.peerConnection.signalingState}`);
          }

        } else if (candidate) {
          console.log(`[WebRTC-${this._logPrefix()}] Received ICE candidate:`, candidate.candidate ? candidate.candidate.substring(0, 20) + '...' : 'empty candidate');
          // Ensure candidate is in RTCIceCandidate format if it's just an object
          const iceCandidate = this._createIceCandidate(candidate);
          if (iceCandidate) {
            try {
              // Add ICE candidate if remote description is set or if it's an empty candidate (end of candidates)
              // Adding candidates before setRemoteDescription can lead to errors or be ignored.
              // However, some implementations might queue them. For robustness, queue if signalingState is not stable.
              if (this.peerConnection.remoteDescription || iceCandidate.candidate === '') {
                 await this.peerConnection.addIceCandidate(iceCandidate);
                 console.log(`[WebRTC-${this._logPrefix()}] Added ICE candidate.`);
              } else {
                console.warn(`[WebRTC-${this._logPrefix()}] Remote description not set, queuing ICE candidate (or received candidate too early). Current state: ${this.peerConnection.signalingState}`);
                // Simple queue: an array on the instance. Process upon setting remote description.
                // This needs more robust handling for production.
                (this.pendingIceCandidates = this.pendingIceCandidates || []).push(iceCandidate);
              }
            } catch (err) {
              if (!this.ignoreOffer) { // Don't error if we're intentionally ignoring due to collision
                console.error(`[WebRTC-${this._logPrefix()}] Error adding received ICE candidate:`, err, 'Candidate:', candidate);
              }
            }
          } else {
             console.warn(`[WebRTC-${this._logPrefix()}] Received invalid ICE candidate data.`);
          }
        }
      } catch (err) {
        console.error(`[WebRTC-${this._logPrefix()}] Error in signal handler:`, err, 'Description:', description, 'Candidate:', candidate);
      }
    });

    // This replaces previous specific listeners like 'offer', 'answer'
    // Ensure to remove old listeners if they were set up outside this class or in a previous version
    this.socket.off('offer');
    this.socket.off('answer');
    // this.socket.off('ice-candidate'); // Keep if server still sends specific 'ice-candidate', otherwise signal handles it
  }

  cleanup() {
    try {
      console.log(`[WebRTC-${this._logPrefix()}] Cleaning up WebRTC connection.`);
      if (this.peerConnection) {
        // Close data channels associated with this peer connection
        if (this.dataChannel) {
            this.dataChannel.close();
            this.dataChannel = null;
        }
        // Stop all senders and receivers
        this.peerConnection.getSenders().forEach(sender => {
          if (sender.track) {
            sender.track.stop();
          }
          // Don't check if pc.removeTrack exists, just call it.
          // try/catch block will handle if sender is already removed or invalid
          try {
            this.peerConnection.removeTrack(sender);
          } catch(e) {
            console.warn(`[WebRTC-${this._logPrefix()}] Error removing track during cleanup: ${e.message}`);
          }
        });
        
        this.peerConnection.close();
        this.peerConnection = null;
        console.log(`[WebRTC-${this._logPrefix()}] PeerConnection closed.`);
      }
      if (this.localStream) {
        this.localStream.getTracks().forEach(track => track.stop());
        this.localStream = null;
        console.log(`[WebRTC-${this._logPrefix()}] Local stream stopped.`);
      }
      // Remove socket listeners specific to this instance if they were uniquely added
      // For generic 'signal', if the socket is shared, be careful.
      // Assuming the socket listener 'signal' is general for the app or managed elsewhere if socket is reused.
      // If this class exclusively owns the socket, then:
      // this.socket.off('signal');

      this.onTrackCallback = null;
      this.onDataChannelMessageCallback = null;
      this.makingOffer = false;
      this.ignoreOffer = false;
      this.pendingIceCandidates = [];

    } catch (error) {
      console.error(`[WebRTC-${this._logPrefix()}] Error during WebRTC cleanup:`, error);
    }
  }
} 