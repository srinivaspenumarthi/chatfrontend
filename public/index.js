// Global state
let peer;
const myVideo = document.getElementById('my-video');
const strangerVideo = document.getElementById('video');
const button = document.getElementById('send');
const skipButton = document.getElementById('skip-button');
const lookingMessage = document.querySelector('.looking-message');
const modal = document.querySelector('.modal');
let remoteSocket;
let type;
let roomid;
let isConnected = false;
let isConnecting = false;
let connectionAttempts = 0;
const MAX_CONNECTION_ATTEMPTS = 3;

// Connection state management
function updateConnectionState(connected) {
  isConnected = connected;
  
  const sendButton = document.getElementById('send');
  const inputBox = document.querySelector('input');
  const toggleVideoBtn = document.getElementById('toggle-video');
  const toggleAudioBtn = document.getElementById('toggle-audio');
  const endCallBtn = document.getElementById('end-call');
  
  if (sendButton) sendButton.disabled = !connected;
  if (inputBox) {
    inputBox.disabled = !connected;
    inputBox.placeholder = connected ? 'Type a message...' : 'Connecting...';
  }
  if (skipButton) skipButton.disabled = isConnecting;
  if (toggleVideoBtn) toggleVideoBtn.disabled = !connected;
  if (toggleAudioBtn) toggleAudioBtn.disabled = !connected;
  if (endCallBtn) endCallBtn.disabled = !connected;
}

// Show/hide looking message
function showLookingMessage() {
  if (lookingMessage) lookingMessage.style.display = 'block';
  if (modal) modal.classList.add('active');
  updateConnectionState(false);
}

function hideLookingMessage() {
  if (lookingMessage) lookingMessage.style.display = 'none';
  if (modal) modal.classList.remove('active');
  updateConnectionState(true);
}

// Initialize with looking message visible
showLookingMessage();

// Start media capture
function start() {
  navigator.mediaDevices.getUserMedia({ audio: true, video: true })
    .then(stream => {
      if (peer && myVideo) {
        myVideo.srcObject = stream;
        
        // Add tracks to peer connection
        stream.getTracks().forEach(track => {
          peer.addTrack(track, stream);
        });

        peer.ontrack = e => {
          if (strangerVideo && e.streams[0]) {
            strangerVideo.srcObject = e.streams[0];
            strangerVideo.play().catch(ex => {
              console.error('Error playing remote video:', ex);
            });
            
            // Hide looking message when video is received
            hideLookingMessage();
          }
        };
        
        // Reset connection attempts on successful media setup
        connectionAttempts = 0;
      }
    })
    .catch(ex => {
      console.error('Error accessing media devices:', ex);
      alert('Could not access media devices. Please check permissions.');
      showLookingMessage();
    });
}

// Connect to server
const socket = io('https://chatbackend-wdog.onrender.com');

// Socket connection handlers
socket.on('connect', () => {
  console.log('Connected to server');
  connectionAttempts = 0;
});

socket.on('connect_error', (error) => {
  console.error('Connection error:', error);
  showLookingMessage();
  cleanupConnection();
});

socket.on('disconnect', (reason) => {
  console.log('Disconnected from server:', reason);
  showLookingMessage();
  cleanupConnection();
});

// On disconnect from peer
socket.on('disconnected', () => {
  console.log('Peer disconnected');
  showLookingMessage();
  cleanupConnection();
  
  // Automatically search for a new connection after delay
  setTimeout(() => {
    startNewConnection();
  }, 2000);
});

// Skip button functionality
if (skipButton) {
  skipButton.addEventListener('click', () => {
    if (isConnected && !isConnecting) {
      handleSkip();
    }
  });
}

function handleSkip() {
  if (isConnecting) return;
  
  isConnecting = true;
  skipButton.disabled = true;
  
  // Notify the other user that we're skipping
  if (roomid) {
    socket.emit('skip', roomid);
  }
  
  // Clean up current connection
  cleanupConnection();
  
  // Show looking message
  showLookingMessage();
  
  // Clear chat
  const chatWrapper = document.querySelector('.wrapper');
  if (chatWrapper) {
    chatWrapper.innerHTML = '';
  }
  
  // Start looking for new connection after delay
  setTimeout(() => {
    startNewConnection();
  }, 2000);
}

// Start new connection
function startNewConnection() {
  if (isConnecting) return;
  
  if (connectionAttempts >= MAX_CONNECTION_ATTEMPTS) {
    console.error('Max connection attempts reached');
    alert('Unable to connect. Please refresh the page and try again.');
    return;
  }
  
  isConnecting = true;
  connectionAttempts++;
  showLookingMessage();
  
  socket.emit('start', (person) => {
    type = person;
    isConnecting = false;
    if (skipButton) skipButton.disabled = false;
  });
}

// Cleanup function
function cleanupConnection() {
  isConnected = false;
  isConnecting = false;
  
  // Close peer connection
  if (peer) {
    peer.close();
    peer = null;
  }
  
  // Clear remote video
  if (strangerVideo && strangerVideo.srcObject) {
    const tracks = strangerVideo.srcObject.getTracks();
    tracks.forEach(track => track.stop());
    strangerVideo.srcObject = null;
  }
  
  // Reset variables
  remoteSocket = null;
  roomid = null;
  type = null;
  
  // Update UI
  updateConnectionState(false);
}

// --------- WebRTC Logic ---------

// Start session (get user type)
socket.emit('start', (person) => {
  type = person;
});

// Remote socket received
socket.on('remote-socket', (id) => {
  remoteSocket = id;
  
  peer = new RTCPeerConnection({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' }
    ]
  });

  peer.onnegotiationneeded = async () => {
    try {
      await webrtc();
    } catch (error) {
      console.error('Error during negotiation:', error);
      handleConnectionError();
    }
  };

  peer.onicecandidate = e => {
    if (e.candidate && remoteSocket) {
      socket.emit('ice:send', { candidate: e.candidate, to: remoteSocket });
    }
  };

  peer.oniceconnectionstatechange = () => {
    console.log('ICE Connection State:', peer.iceConnectionState);
    
    if (peer.iceConnectionState === 'connected' || peer.iceConnectionState === 'completed') {
      connectionAttempts = 0;
      hideLookingMessage();
    } else if (peer.iceConnectionState === 'failed' || peer.iceConnectionState === 'disconnected') {
      console.error('ICE Connection failed/disconnected');
      handleConnectionError();
    }
  };

  peer.onconnectionstatechange = () => {
    console.log('Connection State:', peer.connectionState);
    
    if (peer.connectionState === 'failed' || peer.connectionState === 'disconnected') {
      handleConnectionError();
    }
  };

  start();
});

function handleConnectionError() {
  showLookingMessage();
  cleanupConnection();
  
  // Try reconnecting with exponential backoff
  const delay = Math.min(1000 * Math.pow(2, connectionAttempts - 1), 10000);
  setTimeout(() => {
    startNewConnection();
  }, delay);
}

async function webrtc() {
  if (type === 'p1' && peer) {
    try {
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      socket.emit('sdp:send', { sdp: peer.localDescription });
    } catch (error) {
      console.error('Error creating offer:', error);
      handleConnectionError();
    }
  }
}

// Receive SDP from the other peer
socket.on('sdp:reply', async ({ sdp }) => {
  try {
    if (peer && sdp) {
      await peer.setRemoteDescription(new RTCSessionDescription(sdp));
      
      if (type === 'p2') {
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        socket.emit('sdp:send', { sdp: peer.localDescription });
      }
    }
  } catch (error) {
    console.error('Error handling SDP reply:', error);
    handleConnectionError();
  }
});

// Handle ICE candidates from remote peer
socket.on('ice:reply', async ({ candidate }) => {
  try {
    if (candidate && peer && peer.remoteDescription) {
      await peer.addIceCandidate(new RTCIceCandidate(candidate));
    }
  } catch (error) {
    console.error('Error adding ICE candidate:', error);
  }
});

// When the other user skips
socket.on('skipped', () => {
  console.log('Other user skipped');
  showLookingMessage();
  cleanupConnection();
  
  // Clear chat
  const chatWrapper = document.querySelector('.wrapper');
  if (chatWrapper) {
    chatWrapper.innerHTML = '';
  }
  
  // Start looking for a new connection
  setTimeout(() => {
    startNewConnection();
  }, 2000);
});

// ----------- Message Logic -----------

// Room ID from server
socket.on('roomid', id => {
  roomid = id;
  console.log(`Joined room with ID: ${roomid}`);
  
  if (id) {
    updateConnectionState(true);
  }
});

// Send button handler
if (button) {
  button.onclick = () => {
    sendMessage();
  };
}

function sendMessage() {
  const inputBox = document.querySelector('input');
  if (!inputBox) return;
  
  const message = inputBox.value.trim();

  if (message !== '' && roomid && socket.connected && isConnected) {
    socket.emit('send-message', message, type, roomid);
    addMessageToChat(message, 'sent');
    inputBox.value = '';
  } else if (message !== '') {
    console.warn('Cannot send message: not properly connected');
    // Optional: Show user feedback
    addMessageToChat('Message failed to send - not connected', 'error');
  }
}

// Also send on Enter key
const inputBox = document.querySelector('input');
if (inputBox) {
  inputBox.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      sendMessage();
    }
  });
}

// On receiving a message
socket.on('get-message', (message) => {
  if (message) {
    addMessageToChat(message, 'received');
  }
});

// Function to add message to chat box
function addMessageToChat(message, messageType) {
  const wrapper = document.querySelector('.chat-holder .wrapper');
  if (!wrapper) return;
  
  const msg = document.createElement('div');
  msg.classList.add('message');
  
  if (messageType === 'sent') {
    msg.classList.add('sent-message');
  } else if (messageType === 'received') {
    msg.classList.add('received-message');
  } else if (messageType === 'error') {
    msg.classList.add('error-message');
  }

  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  msg.innerHTML = `
    <div class="text">${escapeHtml(message)}</div>
    <div class="time">${time}</div>
  `;

  wrapper.appendChild(msg);
  wrapper.scrollTop = wrapper.scrollHeight;
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Toggle Video
const toggleVideoBtn = document.getElementById('toggle-video');
if (toggleVideoBtn) {
  toggleVideoBtn.onclick = () => {
    const stream = myVideo?.srcObject;
    const videoTrack = stream?.getVideoTracks()[0];
    
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      
      toggleVideoBtn.classList.toggle('active', videoTrack.enabled);
      toggleVideoBtn.classList.toggle('inactive', !videoTrack.enabled);
    }
  };
}

// Toggle Audio
const toggleAudioBtn = document.getElementById('toggle-audio');
if (toggleAudioBtn) {
  toggleAudioBtn.onclick = () => {
    const stream = myVideo?.srcObject;
    const audioTrack = stream?.getAudioTracks()[0];
    
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      
      toggleAudioBtn.classList.toggle('active', audioTrack.enabled);
      toggleAudioBtn.classList.toggle('inactive', !audioTrack.enabled);
    }
  };
}

// End Call
const endCallBtn = document.getElementById('end-call');
if (endCallBtn) {
  endCallBtn.onclick = () => {
    if (roomid) {
      socket.emit('end-call', roomid);
    }
    cleanupConnection();
    
    // Redirect with small delay to ensure cleanup
    setTimeout(() => {
      window.location.href = '/?disconnect';
    }, 500);
  };
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  cleanupConnection();
  if (roomid) {
    socket.emit('end-call', roomid);
  }
});

// Handle visibility change (tab switch)
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    // Page is hidden
    console.log('Page hidden');
  } else {
    // Page is visible
    console.log('Page visible');
  }
});
