// Global state
let peer;
let localStream;
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
let isMatching = false;
let matchTimer = null;
let connectionVersion = 0;
let pendingIceCandidates = [];
let disconnectTimer = null;

// Show/hide looking message
function showLookingMessage() {
  lookingMessage.style.display = 'block';
  modal.classList.add('active');
  isConnected = false;
}

function hideLookingMessage() {
  lookingMessage.style.display = 'none';
  modal.classList.remove('active');
}

// Initialize with looking message visible
showLookingMessage();

// Start media capture
async function start() {
  try {
    if (!localStream) {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    }

    myVideo.srcObject = localStream;

    if (peer) {
      localStream.getTracks().forEach(track => peer.addTrack(track, localStream));
    }
  } catch (ex) {
    console.error('Error accessing media devices: ', ex);
    alert('Could not access camera/microphone. Please check permissions.');
  }
}

function refreshConnectionState() {
  isConnected = Boolean(roomid && remoteSocket);
}

function requestMatch(delay = 0) {
  if (isMatching) return;

  isMatching = true;

  if (matchTimer) {
    window.clearTimeout(matchTimer);
  }

  matchTimer = window.setTimeout(() => {
    matchTimer = null;
    socket.emit('start', payload => {
      type = payload.type;
      if (!remoteSocket) {
        showLookingMessage();
      }
    });
  }, delay);
}

function stopLocalStream() {
  if (!localStream) return;

  localStream.getTracks().forEach(track => track.stop());
  localStream = null;
  myVideo.srcObject = null;
}

// Connect to server
const socket = io('https://chatbackend-wdog.onrender.com');

// On disconnect
socket.on('disconnected', () => {
  showLookingMessage();
  cleanupConnection();
  clearChat();

  requestMatch(1000);
});

// Skip button functionality
skipButton.addEventListener('click', () => {
  if (isConnected) {
    socket.emit('skip', { roomId: roomid });
    cleanupConnection();
    showLookingMessage();
    clearChat();
    requestMatch();
  }
});

// Cleanup function
function cleanupConnection() {
  connectionVersion += 1;
  pendingIceCandidates = [];

  if (disconnectTimer) {
    window.clearTimeout(disconnectTimer);
    disconnectTimer = null;
  }

  if (matchTimer) {
    window.clearTimeout(matchTimer);
    matchTimer = null;
  }

  if (peer) {
    peer.ontrack = null;
    peer.onnegotiationneeded = null;
    peer.onicecandidate = null;
    peer.oniceconnectionstatechange = null;
    peer.close();
    peer = null;
  }

  if (strangerVideo.srcObject) {
    strangerVideo.srcObject.getTracks().forEach(track => track.stop());
    strangerVideo.srcObject = null;
  }

  remoteSocket = null;
  roomid = null;
  isMatching = false;
  refreshConnectionState();
}

// --------- WebRTC Logic ---------

requestMatch();

function handleMatchFound(remoteSocketId, roomId, nextType = type) {
  const currentVersion = connectionVersion + 1;

  if (peer) {
    cleanupConnection();
  }

  remoteSocket = remoteSocketId;
  roomid = roomId;
  type = nextType;
  isMatching = false;
  refreshConnectionState();
  hideLookingMessage();
  connectionVersion = currentVersion;

  peer = new RTCPeerConnection({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  });

  // ✅ Setup ontrack FIRST
  peer.ontrack = e => {
    if (currentVersion !== connectionVersion) return;

    strangerVideo.srcObject = e.streams[0];
    strangerVideo.play().catch(console.error);
    hideLookingMessage();
  };

  peer.onnegotiationneeded = async () => {
    try {
      if (currentVersion !== connectionVersion) return;
      await webrtc();
    } catch (error) {
      console.error('Negotiation error:', error);
    }
  };

  peer.onicecandidate = e => {
    if (currentVersion !== connectionVersion) return;

    if (e.candidate) {
      socket.emit('ice:send', { candidate: e.candidate, to: remoteSocket, roomId: roomid });
    }
  };

  peer.oniceconnectionstatechange = () => {
    if (!peer || currentVersion !== connectionVersion) return;

    if (peer.iceConnectionState === 'connected' || peer.iceConnectionState === 'completed') {
      if (disconnectTimer) {
        window.clearTimeout(disconnectTimer);
        disconnectTimer = null;
      }
      return;
    }

    if (peer.iceConnectionState === 'disconnected') {
      if (disconnectTimer) {
        window.clearTimeout(disconnectTimer);
      }

      disconnectTimer = window.setTimeout(() => {
        if (!peer || currentVersion !== connectionVersion) return;
        if (peer.iceConnectionState !== 'disconnected') return;

        showLookingMessage();
        cleanupConnection();
        clearChat();
        requestMatch(1000);
      }, 5000);
      return;
    }

    if (peer.iceConnectionState === 'failed' || peer.iceConnectionState === 'closed') {
      showLookingMessage();
      cleanupConnection();
      clearChat();
      requestMatch(1000);
    }
  };

  start(); // ✅ Start media after peer is ready
}

socket.on('match-found', ({ remoteSocketId, roomId, type: nextType }) => {
  handleMatchFound(remoteSocketId, roomId, nextType);
});

socket.on('roomid', id => {
  roomid = id;
  refreshConnectionState();
});

socket.on('remote-socket', id => {
  if (!roomid) {
    return;
  }

  handleMatchFound(id, roomid, type);
});

async function webrtc() {
  if (type === 'p1' && peer && remoteSocket) {
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    socket.emit('sdp:send', { sdp: peer.localDescription, to: remoteSocket, roomId: roomid });
  }
}

async function flushPendingIceCandidates() {
  if (!peer || !peer.remoteDescription) return;

  while (pendingIceCandidates.length > 0) {
    const candidate = pendingIceCandidates.shift();
    if (candidate) {
      await peer.addIceCandidate(candidate);
    }
  }
}

socket.on('sdp:reply', async ({ sdp, from }) => {
  try {
    if (!peer || from !== remoteSocket) return;

    await peer.setRemoteDescription(new RTCSessionDescription(sdp));
    await flushPendingIceCandidates();

    if (type === 'p2') {
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      socket.emit('sdp:send', { sdp: peer.localDescription, to: remoteSocket, roomId: roomid });
    }
  } catch (error) {
    console.error('SDP error:', error);
  }
});

socket.on('ice:reply', async ({ candidate, from }) => {
  try {
    if (candidate && peer && from === remoteSocket) {
      if (peer.remoteDescription) {
        await peer.addIceCandidate(candidate);
      } else {
        pendingIceCandidates.push(candidate);
      }
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
  clearChat();

  // Start finding a new person
  requestMatch(1000);
});


// ----------- Message Logic -----------

button.onclick = () => {
  const inputBox = document.querySelector('input');
  const message = inputBox.value.trim();
  if (message !== '' && isConnected) {
    socket.emit('send-message', { message, roomId: roomid });
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
  if (roomid) {
    socket.emit('skip', { roomId: roomid });
  }
  stopLocalStream();
  cleanupConnection();
  location.href = '/';
};

window.addEventListener('beforeunload', () => {
  stopLocalStream();
});
