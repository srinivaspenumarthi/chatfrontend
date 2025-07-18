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
let localStream;
let remoteStream;

// ICE servers configuration with TURN servers for better connectivity
const iceServers = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    // Free TURN servers for better NAT traversal
    {
      urls: 'turn:numb.viagenie.ca',
      credential: 'turnserver',
      username: 'webrtc@live.com'
    },
    {
      urls: 'turn:turn.bistri.com:80',
      credential: 'homeo',
      username: 'homeo'
    }
  ],
  iceCandidatePoolSize: 10
};

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

// Enhanced video play function with error handling
async function playVideo(videoElement, stream) {
  if (!videoElement || !stream) return;
  
  try {
    // Stop any existing playback
    if (videoElement.srcObject) {
      const tracks = videoElement.srcObject.getTracks();
      tracks.forEach(track => track.stop());
    }
    
    // Set new stream
    videoElement.srcObject = stream;
    
    // Add required attributes for mobile compatibility
    videoElement.setAttribute('playsinline', '');
    videoElement.setAttribute('autoplay', '');
    videoElement.muted = videoElement === myVideo; // Only mute local video
    
    // Wait for metadata to load
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Video load timeout')), 5000);
      
      videoElement.addEventListener('loadedmetadata', () => {
        clearTimeout(timeout);
        resolve();
      }, { once: true });
      
      videoElement.addEventListener('error', (e) => {
        clearTimeout(timeout);
        reject(e);
      }, { once: true });
    });
    
    // Attempt to play
    await videoElement.play();
    console.log('Video playing successfully');
    
  } catch (error) {
    console.error('Error playing video:', error);
    
    // Retry with user interaction fallback
    if (error.name === 'NotAllowedError' || error.name === 'AbortError') {
      console.log('Autoplay blocked, waiting for user interaction');
      
      // Show click to play message
      const playButton = document.createElement('button');
      playButton.textContent = 'Click to Play Video';
      playButton.style.position = 'absolute';
      playButton.style.top = '50%';
      playButton.style.left = '50%';
      playButton.style.transform = 'translate(-50%, -50%)';
      playButton.style.zIndex = '1000';
      
      videoElement.parentNode.appendChild(playButton);
      
      playButton.addEventListener('click', async () => {
        try {
          await videoElement.play();
          playButton.remove();
        } catch (retryError) {
          console.error('Retry play failed:', retryError);
        }
      });
    }
  }
}

// Start media capture with enhanced error handling
async function start() {
  try {
    // Request media with specific constraints
    const constraints = {
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      video: {
        width: { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { ideal: 30 }
      }
    };
    
    localStream = await navigator.mediaDevices.getUserMedia(constraints);
    
    if (peer && myVideo) {
      // Play local video
      await playVideo(myVideo, localStream);
      
      // Add tracks to peer connection
      localStream.getTracks().forEach(track => {
        peer.addTrack(track, localStream);
      });

      // Enhanced ontrack handler
      
      
      // Reset connection attempts on successful media setup
      connectionAttempts = 0;
    }
  } catch (error) {
    console.error('Error accessing media devices:', error);
    
    let errorMessage = 'Could not access media devices. ';
    if (error.name === 'NotFoundError') {
      errorMessage += 'No camera or microphone found.';
    } else if (error.name === 'NotAllowedError') {
      errorMessage += 'Please allow camera and microphone access.';
    } else if (error.name === 'NotReadableError') {
      errorMessage += 'Camera or microphone is being used by another application.';
    } else {
      errorMessage += 'Please check your device permissions.';
    }
    
    alert(errorMessage);
    showLookingMessage();
  }
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
  }, 3000);
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
  }, 3000);
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

// Enhanced cleanup function
function cleanupConnection() {
  isConnected = false;
  isConnecting = false;
  
  // Close peer connection
  if (peer) {
    peer.close();
    peer = null;
  }
  
  // Stop and clear remote stream
  if (remoteStream) {
    remoteStream.getTracks().forEach(track => track.stop());
    remoteStream = null;
  }
  
  // Clear remote video
  if (strangerVideo) {
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
  console.log('Remote socket connected:', id);
  
  // Create peer connection with enhanced configuration
  peer = new RTCPeerConnection(iceServers);
  peer.ontrack = async (event) => {
  console.log('Received remote track:', event.track.kind);

  if (event.streams && event.streams[0]) {
    remoteStream = event.streams[0];
  } else {
    // Fallback: build stream manually
    if (!remoteStream) {
      remoteStream = new MediaStream();
    }
    remoteStream.addTrack(event.track);
  }

  // ✅ Attempt to play
  await playVideo(strangerVideo, remoteStream);
  hideLookingMessage();
  updateConnectionState(true);
};
  // Enhanced negotiation handler
  peer.onnegotiationneeded = async () => {
    try {
      console.log('Negotiation needed');
      await webrtc();
    } catch (error) {
      console.error('Error during negotiation:', error);
      handleConnectionError();
    }
  };

  // ICE candidate handler
  peer.onicecandidate = (event) => {
    if (event.candidate && remoteSocket) {
      console.log('Sending ICE candidate:', event.candidate.type);
      socket.emit('ice:send', { candidate: event.candidate, to: remoteSocket });
    } else if (!event.candidate) {
      console.log('ICE gathering complete');
    }
  };

  // Enhanced ICE connection state handler
  peer.oniceconnectionstatechange = () => {
    console.log('ICE Connection State:', peer.iceConnectionState);
    
    switch (peer.iceConnectionState) {
      case 'connected':
      case 'completed':
        console.log('ICE connection established');
        connectionAttempts = 0;
        break;
      case 'disconnected':
        console.log('ICE connection disconnected');
        // Don't immediately fail, might reconnect
        setTimeout(() => {
          if (peer && peer.iceConnectionState === 'disconnected') {
            handleConnectionError();
          }
        }, 5000);
        break;
      case 'failed':
        console.error('ICE connection failed');
        handleConnectionError();
        break;
      case 'closed':
        console.log('ICE connection closed');
        break;
    }
  };

  // Connection state handler
 // Connection state handler
peer.onconnectionstatechange = () => {
  console.log('Connection State:', peer.connectionState);
  
  switch (peer.connectionState) {
    case 'connected':
      console.log('Peer connection established');
      isConnected = true;
      hideLookingMessage();          // ✅ Hide modal/UI here
      updateConnectionState(true);   // ✅ Enable UI (chat, buttons, etc.)
      break;
    case 'disconnected':
      console.log('Peer connection disconnected');
      break;
    case 'failed':
      console.error('Peer connection failed');
      handleConnectionError();
      break;
    case 'closed':
      console.log('Peer connection closed');
      break;
  }
};


  // Start media capture
  start();
});

function handleConnectionError() {
  console.log('Handling connection error');
  showLookingMessage();
  cleanupConnection();
  
  // Try reconnecting with exponential backoff
  const delay = Math.min(2000 * Math.pow(2, connectionAttempts - 1), 15000);
  console.log(`Reconnecting in ${delay}ms`);
  
  setTimeout(() => {
    if (connectionAttempts < MAX_CONNECTION_ATTEMPTS) {
      startNewConnection();
    } else {
      alert('Connection failed multiple times. Please refresh the page.');
    }
  }, delay);
}

// Enhanced WebRTC signaling
async function webrtc() {
  if (type === 'p1' && peer) {
    try {
      console.log('Creating offer');
      const offer = await peer.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
      });
      
      await peer.setLocalDescription(offer);
      console.log('Local description set');
      
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
      console.log('Received SDP:', sdp.type);
      
      await peer.setRemoteDescription(new RTCSessionDescription(sdp));
      console.log('Remote description set');
      
      if (type === 'p2') {
        console.log('Creating answer');
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
      console.log('Adding ICE candidate:', candidate.type);
      await peer.addIceCandidate(new RTCIceCandidate(candidate));
    }
  } catch (error) {
    console.error('Error adding ICE candidate:', error);
    // Don't fail the connection for ICE candidate errors
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
  }, 3000);
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

// Enhanced Toggle Video
const toggleVideoBtn = document.getElementById('toggle-video');
if (toggleVideoBtn) {
  toggleVideoBtn.onclick = () => {
    const videoTrack = localStream?.getVideoTracks()[0];
    
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      
      toggleVideoBtn.classList.toggle('active', videoTrack.enabled);
      toggleVideoBtn.classList.toggle('inactive', !videoTrack.enabled);
      
      console.log('Video toggled:', videoTrack.enabled ? 'on' : 'off');
    }
  };
}

// Enhanced Toggle Audio
const toggleAudioBtn = document.getElementById('toggle-audio');
if (toggleAudioBtn) {
  toggleAudioBtn.onclick = () => {
    const audioTrack = localStream?.getAudioTracks()[0];
    
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      
      toggleAudioBtn.classList.toggle('active', audioTrack.enabled);
      toggleAudioBtn.classList.toggle('inactive', !audioTrack.enabled);
      
      console.log('Audio toggled:', audioTrack.enabled ? 'on' : 'off');
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
    
    // Stop local stream
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
      localStream = null;
    }
    
    // Redirect with small delay to ensure cleanup
    setTimeout(() => {
      window.location.href = '/?disconnect';
    }, 500);
  };
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  cleanupConnection();
  
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
  }
  
  if (roomid) {
    socket.emit('end-call', roomid);
  }
});

// Handle visibility change (tab switch)
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    console.log('Page hidden');
  } else {
    console.log('Page visible');
    // Optionally restart video if it stopped
    if (localStream && myVideo && !myVideo.srcObject) {
      playVideo(myVideo, localStream);
    }
  }
});

// Handle browser autoplay policy
document.addEventListener('click', () => {
  // Try to play videos on first user interaction
  if (myVideo && myVideo.srcObject && myVideo.paused) {
    myVideo.play().catch(console.error);
  }
  if (strangerVideo && strangerVideo.srcObject && strangerVideo.paused) {
    strangerVideo.play().catch(console.error);
  }
}, { once: true });
