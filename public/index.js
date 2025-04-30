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

// Show/hide looking message
function showLookingMessage() {
  lookingMessage.style.display = 'block';
  modal.classList.add('active');
  isConnected = false;
}

function hideLookingMessage() {
  lookingMessage.style.display = 'none';
  modal.classList.remove('active');
  isConnected = true;
}

// Initialize with looking message visible
showLookingMessage();

// Start media capture
function start() {
  navigator.mediaDevices.getUserMedia({ audio: true, video: true })
    .then(stream => {
      if (peer) {
        myVideo.srcObject = stream;
        stream.getTracks().forEach(track => peer.addTrack(track, stream));

        peer.ontrack = e => {
          strangerVideo.srcObject = e.streams[0];
          strangerVideo.play();
          // Hide looking message when video is received
          hideLookingMessage();
        };
      }
    })
    .catch(ex => {
      console.error('Error accessing media devices: ', ex);
      alert('Could not access media devices. Please check permissions.');
    });
}

// Connect to server
const socket = io('https://chatbackend-wdog.onrender.com');

// On disconnect
socket.on('disconnected', () => {
  showLookingMessage();
  cleanupConnection();
  
  // Automatically search for a new connection
  setTimeout(() => {
    socket.emit('start', (person) => {
      type = person;
    });
  }, 1000);
});

// Skip button functionality
skipButton.addEventListener('click', () => {
  if (isConnected) {
    // Notify the other user that we're skipping
    socket.emit('skip', roomid);
    
    // Clean up current connection
    cleanupConnection();
    
    // Show looking message
    showLookingMessage();
    
    // Clear chat
    document.querySelector('.wrapper').innerHTML = '';
    
    // Start looking for new connection
    socket.emit('start', (person) => {
      type = person;
    });
  }
});

// Cleanup function
function cleanupConnection() {
  if (peer) {
    peer.close();
    peer = null;
  }
  
  // Clear remote video
  if (strangerVideo.srcObject) {
    const tracks = strangerVideo.srcObject.getTracks();
    tracks.forEach(track => track.stop());
    strangerVideo.srcObject = null;
  }
  
  remoteSocket = null;
  roomid = null;
}

// --------- WebRTC Logic ---------

// Start session (get user type)
socket.emit('start', (person) => {
  type = person;
});

// Remote socket received
socket.on('remote-socket', (id) => {
  remoteSocket = id;
  
  // Hide looking message on connection
  hideLookingMessage();
  
  peer = new RTCPeerConnection({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  });

  peer.onnegotiationneeded = async () => {
    try {
      await webrtc();
    } catch (error) {
      console.error('Error during negotiation:', error);
    }
  };

  peer.onicecandidate = e => {
    if (e.candidate) {
      socket.emit('ice:send', { candidate: e.candidate, to: remoteSocket });
    }
  };

  peer.oniceconnectionstatechange = () => {
    if (peer.iceConnectionState === 'failed') {
      console.error('ICE Connection failed');
      showLookingMessage();
      cleanupConnection();
      
      // Try reconnecting
      setTimeout(() => {
        socket.emit('start', (person) => {
          type = person;
        });
      }, 1000);
    }
  };

  start();
});

async function webrtc() {
  if (type === 'p1') {
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    socket.emit('sdp:send', { sdp: peer.localDescription });
  }
}

// Receive SDP from the other peer
socket.on('sdp:reply', async ({ sdp }) => {
  try {
    await peer.setRemoteDescription(new RTCSessionDescription(sdp));
    if (type === 'p2') {
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      socket.emit('sdp:send', { sdp: peer.localDescription });
    }
  } catch (error) {
    console.error('Error handling SDP reply:', error);
  }
});

// Handle ICE candidates from remote peer
socket.on('ice:reply', async ({ candidate }) => {
  try {
    if (candidate && peer) {
      await peer.addIceCandidate(candidate);
    }
  } catch (error) {
    console.error('Error adding ICE candidate:', error);
  }
});

// When the other user skips
socket.on('skipped', () => {
  showLookingMessage();
  cleanupConnection();
  document.querySelector('.wrapper').innerHTML = '';
  
  // Start looking for a new connection
  setTimeout(() => {
    socket.emit('start', (person) => {
      type = person;
    });
  }, 1000);
});

// ----------- Message Logic -----------

// Room ID from server
socket.on('roomid', id => {
  roomid = id;
  console.log(`Joined room with ID: ${roomid}`);
});

// Send button handler
button.onclick = () => {
  const inputBox = document.querySelector('input');
  const message = inputBox.value.trim();

  if (message !== '' && isConnected) {
    socket.emit('send-message', message, type, roomid);
    addMessageToChat(message, 'sent');
    inputBox.value = '';
  }
};

// Also send on Enter key
document.querySelector('input').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    button.click();
  }
});

// On receiving a message
socket.on('get-message', (message) => {
  addMessageToChat(message, 'received');
});

// Function to add message to chat box
function addMessageToChat(message, messageType) {
  const wrapper = document.querySelector('.chat-holder .wrapper');
  const msg = document.createElement('div');
  msg.classList.add('message');
  msg.classList.add(messageType === 'sent' ? 'sent-message' : 'received-message');

  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  msg.innerHTML = `
    <div class="text">${message}</div>
    <div class="time">${time}</div>
  `;

  wrapper.appendChild(msg);
  wrapper.scrollTop = wrapper.scrollHeight; // Scroll to bottom
}

// Toggle Video
document.getElementById('toggle-video').onclick = () => {
  const stream = myVideo.srcObject;
  const videoTrack = stream?.getVideoTracks()[0];
  if (videoTrack) {
    videoTrack.enabled = !videoTrack.enabled;

    const btn = document.getElementById('toggle-video');
    btn.classList.toggle('active', videoTrack.enabled);
    btn.classList.toggle('inactive', !videoTrack.enabled);
  }
};

// Toggle Audio
document.getElementById('toggle-audio').onclick = () => {
  const stream = myVideo.srcObject;
  const audioTrack = stream?.getAudioTracks()[0];
  if (audioTrack) {
    audioTrack.enabled = !audioTrack.enabled;

    const btn = document.getElementById('toggle-audio');
    btn.classList.toggle('active', audioTrack.enabled);
    btn.classList.toggle('inactive', !audioTrack.enabled);
  }
};

// End Call
document.getElementById('end-call').onclick = () => {
  socket.emit('end-call', roomid); // Notify backend to clean up
  cleanupConnection();
  location.href = '/?disconnect';
};
