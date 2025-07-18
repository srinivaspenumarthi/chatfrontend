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
      myVideo.srcObject = stream;

      stream.getTracks().forEach(track => peer.addTrack(track, stream));
    })
    .catch(ex => {
      console.error('Error accessing media devices: ', ex);
      alert('Could not access camera/microphone. Please check permissions.');
    });
}

// Connect to server
const socket = io('https://chatbackend-wdog.onrender.com');

// On disconnect
socket.on('disconnected', () => {
  showLookingMessage();
  cleanupConnection();

  setTimeout(() => {
    socket.emit('start', person => {
      type = person;
    });
  }, 1000);
});

// Skip button functionality
skipButton.addEventListener('click', () => {
  if (isConnected) {
    socket.emit('skip', roomid);
    cleanupConnection();
    showLookingMessage();
    clearChat();

    socket.emit('start', person => {
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

  if (strangerVideo.srcObject) {
    strangerVideo.srcObject.getTracks().forEach(track => track.stop());
    strangerVideo.srcObject = null;
  }

  remoteSocket = null;
  roomid = null;
  isConnected = false;
}

// --------- WebRTC Logic ---------

socket.emit('start', person => {
  type = person;
});

// Remote socket received
socket.on('remote-socket', id => {
  remoteSocket = id;
  hideLookingMessage();

  peer = new RTCPeerConnection({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  });

  // ✅ Setup ontrack FIRST
  peer.ontrack = e => {
    strangerVideo.srcObject = e.streams[0];
    strangerVideo.play().catch(console.error);
    hideLookingMessage();
  };

  peer.onnegotiationneeded = async () => {
    try {
      await webrtc();
    } catch (error) {
      console.error('Negotiation error:', error);
    }
  };

  peer.onicecandidate = e => {
    if (e.candidate) {
      socket.emit('ice:send', { candidate: e.candidate, to: remoteSocket });
    }
  };

  peer.oniceconnectionstatechange = () => {
    if (peer.iceConnectionState === 'failed') {
      showLookingMessage();
      cleanupConnection();
      setTimeout(() => {
        socket.emit('start', person => {
          type = person;
        });
      }, 1000);
    }
  };

  start(); // ✅ Start media after peer is ready
});

async function webrtc() {
  if (type === 'p1') {
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    socket.emit('sdp:send', { sdp: peer.localDescription });
  }
}

socket.on('sdp:reply', async ({ sdp }) => {
  try {
    await peer.setRemoteDescription(new RTCSessionDescription(sdp));
    if (type === 'p2') {
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      socket.emit('sdp:send', { sdp: peer.localDescription });
    }
  } catch (error) {
    console.error('SDP error:', error);
  }
});

socket.on('ice:reply', async ({ candidate }) => {
  try {
    if (candidate) {
      await peer.addIceCandidate(candidate);
    }
  } catch (error) {
    console.error('ICE error:', error);
  }
});

socket.on('skipped', () => {
  console.log('Other user skipped');

  // Cleanup current call
  cleanupConnection();
  showLookingMessage();
  document.querySelector('.wrapper').innerHTML = '';

  // Start finding a new person
  setTimeout(() => {
    socket.emit('start', (person) => {
      type = person;
    });
  }, 1000);
});


// ----------- Message Logic -----------

socket.on('roomid', id => {
  roomid = id;
  console.log(`Joined room: ${roomid}`);
  isConnected = true;
});

button.onclick = () => {
  const inputBox = document.querySelector('input');
  const message = inputBox.value.trim();
  if (message !== '' && isConnected) {
    socket.emit('send-message', message, type, roomid);
    addMessageToChat(message, 'sent');
    inputBox.value = '';
  }
};

document.querySelector('input').addEventListener('keypress', e => {
  if (e.key === 'Enter') button.click();
});

socket.on('get-message', message => {
  addMessageToChat(message, 'received');
});

function addMessageToChat(message, messageType) {
  const wrapper = document.querySelector('.chat-holder .wrapper');
  const msg = document.createElement('div');
  msg.className = `message ${messageType === 'sent' ? 'sent-message' : 'received-message'}`;

  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  msg.innerHTML = `
    <div class="text">${escapeHtml(message)}</div>
    <div class="time">${time}</div>
  `;

  wrapper.appendChild(msg);
  wrapper.scrollTop = wrapper.scrollHeight;
}

function clearChat() {
  const wrapper = document.querySelector('.chat-holder .wrapper');
  if (wrapper) wrapper.innerHTML = '';
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
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
  socket.emit('end-call', roomid);
  cleanupConnection();
  location.href = '/?disconnect';
};
