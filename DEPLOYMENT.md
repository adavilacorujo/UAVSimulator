# Deployment Guide for UAV Browser Simulator

This guide provides instructions for deploying the UAV Browser Simulator in a production environment with HTTPS, which is required for camera and geolocation access in most modern browsers.

## Prerequisites

- A server with Node.js (v14+) installed
- A domain name pointing to your server
- Basic knowledge of server administration

## Option 1: Deploy with Node.js and a Reverse Proxy

### 1. Set up a reverse proxy (Nginx or Apache)

#### Nginx Configuration Example

```nginx
server {
    listen 80;
    server_name yourdomain.com;
    
    # Redirect all HTTP traffic to HTTPS
    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl;
    server_name yourdomain.com;
    
    # SSL Configuration
    ssl_certificate /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;
    
    # Proxy to Node.js application
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### 2. Obtain SSL Certificate

You can obtain a free SSL certificate from Let's Encrypt using certbot:

```bash
sudo apt-get install certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com
```

### 3. Clone and Set Up the Application

```bash
# Clone the repository
git clone https://github.com/yourusername/uav-browser-simulator.git
cd uav-browser-simulator

# Install dependencies
npm run install-deps

# Start the application (consider using PM2 to keep it running)
npm install -g pm2
pm2 start server/server.js --name uav-simulator
pm2 save
```

## Option 2: Run with HTTPS Directly in Node.js

You can also configure the application to use HTTPS directly:

### 1. Obtain SSL Certificates

```bash
sudo apt-get install certbot
sudo certbot certonly --standalone -d yourdomain.com
```

### 2. Modify the server.js file

Edit the server.js file to use HTTPS:

```javascript
const fs = require('fs');
const https = require('https');
const express = require('express');
// ... other existing requires

const app = express();
// ... existing app setup

// Add HTTPS support
const httpsOptions = {
  key: fs.readFileSync('/etc/letsencrypt/live/yourdomain.com/privkey.pem'),
  cert: fs.readFileSync('/etc/letsencrypt/live/yourdomain.com/fullchain.pem')
};

const server = https.createServer(httpsOptions, app);
// ... rest of your existing code
```

### 3. Update the server port

If you're using HTTPS directly, consider changing the port to 443 (default HTTPS port):

```javascript
const PORT = process.env.PORT || 443;
```

Remember to run the application with sudo if using port 443 directly, or configure Node.js to bind to privileged ports.

## Option 3: Deploying to Cloud Services

### Deploy to Heroku

1. Create a `Procfile` in the root directory:

```
web: cd server && npm start
```

2. Commit and push to Heroku:

```bash
heroku create
git push heroku main
```

Heroku provides HTTPS by default for all applications.

### Deploy to Render, Netlify, or Vercel

These platforms also provide HTTPS by default and have simple deployment processes through their web interfaces or CLI tools. Follow their documentation for Node.js applications.

## Additional Production Considerations

1. **Environment Variables**: Store configurations like ports and database connections as environment variables.

2. **TURN Servers**: For WebRTC to work reliably across different networks, consider setting up TURN servers. Services like Twilio TURN or coturn can be used.

3. **Security Hardening**:
   - Implement authentication for the drone interface
   - Use helmet.js to add security headers
   - Rate limit your API endpoints
   - Validate all input data

4. **Monitoring**:
   - Consider using tools like PM2, Sentry, or LogRocket for monitoring
   - Set up health checks for your application
   - Implement logging for debugging

5. **Scaling**:
   - You may need to use a WebSocket implementation that supports horizontal scaling (like Socket.IO Redis adapter)
   - Consider separating the signal server and file serving components 