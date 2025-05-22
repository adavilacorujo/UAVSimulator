/**
 * Telemetry utility functions for the UAV browser simulator
 */

class TelemetryManager {
  constructor(socket) {
    this.socket = socket;
    this.watchId = null;
    this.onTelemetryUpdateCallback = null;
    this.simulationMode = false;
    this.simulationData = {
      latitude: 37.7749,
      longitude: -122.4194,
      altitude: 100,
      heading: 0,
      speed: 0,
      timestamp: Date.now()
    };
    this.simulationIntervalId = null;
    this.usingRealPosition = false;
    
    // Set up telemetry listener if not in drone mode
    this.socket.on('telemetry', (data) => {
      if (this.onTelemetryUpdateCallback) {
        try {
          this.onTelemetryUpdateCallback(data);
        } catch (error) {
          console.error('Error in telemetry update callback:', error);
        }
      }
    });
  }
  
  /**
   * Start collecting telemetry data
   * @param {boolean} simulate - Whether to use simulation as fallback when real data is unavailable
   */
  startTelemetry(simulate = false) {
    try {
      // Save simulation preference (only used as fallback)
      this.simulationMode = simulate;
      
      // Always try to use real geolocation first
      this._startRealTelemetry();
    } catch (error) {
      console.error('Error starting telemetry:', error);
      // Fall back to simulation mode if there's an error and simulation is allowed
      if (this.simulationMode) {
        this._startSimulation();
      } else {
        console.error('Real geolocation failed and simulation is disabled');
      }
    }
  }
  
  /**
   * Stop collecting telemetry data
   */
  stopTelemetry() {
    try {
      if (this.watchId) {
        navigator.geolocation.clearWatch(this.watchId);
        this.watchId = null;
      }
      
      if (this.simulationIntervalId) {
        clearInterval(this.simulationIntervalId);
        this.simulationIntervalId = null;
      }
      
      this.usingRealPosition = false;
    } catch (error) {
      console.error('Error stopping telemetry:', error);
    }
  }
  
  /**
   * Register a callback for telemetry updates
   * @param {Function} callback - Function to call when telemetry is updated
   */
  onTelemetryUpdate(callback) {
    this.onTelemetryUpdateCallback = callback;
  }
  
  /**
   * Send telemetry data over socket
   * @param {Object} data - Telemetry data to send
   */
  sendTelemetry(data) {
    try {
      // Only include the source info for debugging purposes
      const telemetryData = {
        latitude: typeof data.latitude === 'number' ? data.latitude : this.simulationData.latitude,
        longitude: typeof data.longitude === 'number' ? data.longitude : this.simulationData.longitude,
        altitude: typeof data.altitude === 'number' ? data.altitude : this.simulationData.altitude,
        heading: typeof data.heading === 'number' ? data.heading : this.simulationData.heading,
        speed: typeof data.speed === 'number' ? data.speed : this.simulationData.speed,
        timestamp: data.timestamp || Date.now(),
        source: this.usingRealPosition ? 'geolocation' : 'simulation'
      };
      
      console.log(`Sending telemetry from ${telemetryData.source}: lat=${telemetryData.latitude.toFixed(6)}, lon=${telemetryData.longitude.toFixed(6)}`);
      this.socket.emit('telemetry', telemetryData);
      
      // Also call the local callback if registered
      if (this.onTelemetryUpdateCallback) {
        this.onTelemetryUpdateCallback(telemetryData);
      }
    } catch (error) {
      console.error('Error sending telemetry data:', error);
    }
  }
  
  /**
   * Check if geolocation is supported and permissions can be requested
   * @returns {boolean} True if geolocation is supported
   */
  _isGeolocationSupported() {
    return navigator.geolocation && 
           typeof navigator.geolocation.watchPosition === 'function';
  }
  
  /**
   * Start collecting real telemetry data
   */
  _startRealTelemetry() {
    if (!this._isGeolocationSupported()) {
      console.warn('Geolocation is not supported by this browser.');
      
      // Fall back to simulation only if allowed
      if (this.simulationMode) {
        console.warn('Falling back to simulation mode.');
        this._startSimulation();
      }
      return;
    }
    
    console.log('Attempting to start real geolocation tracking...');
    
    this.watchId = navigator.geolocation.watchPosition(
      (position) => {
        try {
          console.log('Received real position:', position.coords);
          // Set flag that we're using real position data
          this.usingRealPosition = true;
          
          const telemetryData = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            altitude: position.coords.altitude || 0,
            heading: position.coords.heading || 0,
            speed: position.coords.speed || 0,
            timestamp: position.timestamp
          };
          
          // Update simulation data with real values (for potential fallback)
          this.simulationData = {
            ...this.simulationData,
            latitude: position.coords.latitude,
            longitude: position.coords.longitude
          };
          
          this.sendTelemetry(telemetryData);
        } catch (error) {
          console.error('Error processing geolocation data:', error);
          
          // If we get an error processing real data and simulation is allowed, use that
          if (this.simulationMode && !this.simulationIntervalId) {
            console.warn('Error with real geolocation, falling back to simulation');
            this._startSimulation();
          }
        }
      },
      (error) => {
        this.usingRealPosition = false;
        console.error('Error getting geolocation:', error);
        
        // Show a more specific error message based on the error code
        switch (error.code) {
          case error.PERMISSION_DENIED:
            console.error('User denied geolocation permission');
            break;
          case error.POSITION_UNAVAILABLE:
            console.error('Location information is unavailable');
            break;
          case error.TIMEOUT:
            console.error('Geolocation request timed out');
            break;
          default:
            console.error('Unknown geolocation error');
        }
        
        // Fall back to simulation only if allowed
        if (this.simulationMode) {
          console.warn('Falling back to simulation mode after geolocation error');
          this._startSimulation();
        }
      },
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 5000
      }
    );
  }
  
  /**
   * Start simulating telemetry data
   */
  _startSimulation() {
    try {
      console.log('Starting telemetry simulation mode');
      this.usingRealPosition = false;
      
      // Clear any existing interval to prevent duplicates
      if (this.simulationIntervalId) {
        clearInterval(this.simulationIntervalId);
      }
      
      const updateSimulation = () => {
        try {
          // Update simulated position (circular pattern)
          const now = Date.now();
          const elapsed = (now - this.simulationData.timestamp) / 1000; // seconds
          
          // Update heading (0-359 degrees)
          this.simulationData.heading = (this.simulationData.heading + 1) % 360;
          
          // Move in the direction of heading
          const speed = 0.00001; // degree change per update
          const headingRad = this.simulationData.heading * (Math.PI / 180);
          
          this.simulationData.latitude += Math.cos(headingRad) * speed;
          this.simulationData.longitude += Math.sin(headingRad) * speed;
          
          // Fluctuate altitude
          this.simulationData.altitude = 100 + Math.sin(now / 10000) * 20;
          
          // Update speed (0-10 m/s with some randomness)
          this.simulationData.speed = 5 + Math.sin(now / 5000) * 3 + (Math.random() - 0.5);
          
          // Update timestamp
          this.simulationData.timestamp = now;
          
          this.sendTelemetry({ ...this.simulationData });
        } catch (error) {
          console.error('Error in simulation update:', error);
        }
      };
      
      // Update simulation data at regular intervals
      this.simulationIntervalId = setInterval(updateSimulation, 500);
      updateSimulation(); // Initial update
    } catch (error) {
      console.error('Error starting simulation:', error);
    }
  }
} 