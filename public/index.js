let peer;
let localStream;
let remoteSocket = null;
let type = null;
let roomid = null;
let isConnected = false;
let isMatching = false;
let matchTimer = null;
let sessionVersion = 0;
let pendingIceCandidates = [];

const myVideo = document.getElementById('my-video');
const strangerVideo = document.getElementById('video');
const button = document.getElementById('send');
const skipButton = document.getElementById('skip-button');
const lookingMessage = document.querySelector('.looking-message');
const modal = document.querySelector('.modal');
const socket = io('https://chatbackend-wdog.onrender.com');

function showLookingMessage() {
  lookingMessage.style.display = 'block';
  modal.classList.add('active');
}

function hideLookingMessage() {
  lookingMessage.style.display = 'none';
  modal.classList.remove('active');
}

function refreshConnectionState() {
  isConnected = Boolean(roomid && remoteSocket);
}

async function ensureLocalStream() {
  if (!localStream) {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
  }

  myVideo.srcObject = localStream;
  return localStream;
}

async function attachLocalTracks(currentPeer) {
  const stream = await ensureLocalStream();
  stream.getTracks().forEach((track) => {
    currentPeer.addTrack(track, stream);
  });
}

function requestMatch(delay = 0) {
  if (isMatching) return;

  isMatching = true;
  showLookingMessage();

  if (matchTimer) {
    window.clearTimeout(matchTimer);
  }

  matchTimer = window.setTimeout(() => {
    matchTimer = null;
    socket.emit('start');
  }, delay);
}

function cleanupConnection() {
  sessionVersion += 1;
  pendingIceCandidates = [];

  if (matchTimer) {
    window.clearTimeout(matchTimer);
    matchTimer = null;
  }

  if (peer) {
    peer.ontrack = null;
    peer.onicecandidate = null;
    peer.oniceconnectionstatechange = null;
    peer.onnegotiationneeded = null;
    peer.close();
    peer = null;
  }

  if (strangerVideo.srcObject) {
    strangerVideo.srcObject.getTracks().forEach((track) => track.stop());
    strangerVideo.srcObject = null;
  }

  remoteSocket = null;
  roomid = null;
  type = null;
  isConnected = false;
  isMatching = false;
}

async function flushPendingIceCandidates(currentPeer) {
  if (!currentPeer.remoteDescription) return;

  while (pendingIceCandidates.length > 0) {
    const candidate = pendingIceCandidates.shift();
    if (candidate) {
      await currentPeer.addIceCandidate(candidate);
    }
  }
}

async function sendOffer(currentPeer, currentRoomId, currentRemoteSocket) {
  const offer = await currentPeer.createOffer();
  await currentPeer.setLocalDescription(offer);
  socket.emit('sdp:send', {
    sdp: currentPeer.localDescription,
    to: currentRemoteSocket,
    roomId: currentRoomId,
  });
}

async function beginMatch({ remoteSocketId, roomId, type: nextType }) {
  cleanupConnection();
  console.log('[match-found]', { roomId, remoteSocketId, type: nextType });

  const version = sessionVersion;
  const currentPeer = new RTCPeerConnection({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ],
  });

  peer = currentPeer;
  remoteSocket = remoteSocketId;
  roomid = roomId;
  type = nextType;
  isMatching = false;
  refreshConnectionState();
  hideLookingMessage();

  currentPeer.ontrack = (event) => {
    if (version !== sessionVersion) return;
    const [remoteStream] = event.streams;
    if (strangerVideo.srcObject !== remoteStream) {
      strangerVideo.srcObject = remoteStream;
    }
    console.log('[ontrack]', { roomId, remoteSocketId, trackKind: event.track?.kind });
  };

  currentPeer.onicecandidate = (event) => {
    if (version !== sessionVersion || !event.candidate) return;
    console.log('[ice-send]', { roomId, remoteSocketId });
    socket.emit('ice:send', {
      candidate: event.candidate,
      to: remoteSocketId,
      roomId,
    });
  };

  currentPeer.oniceconnectionstatechange = () => {
    if (version !== sessionVersion || !peer) return;
    console.log('[ice-state]', { roomId, state: currentPeer.iceConnectionState });
    if (currentPeer.iceConnectionState === 'failed') {
      console.error('Peer connection failed for room', roomId);
      cleanupConnection();
      clearChat();
      showLookingMessage();
    }
  };

  currentPeer.onnegotiationneeded = async () => {
    if (version !== sessionVersion || nextType !== 'p1') return;
    try {
      await sendOffer(currentPeer, roomId, remoteSocketId);
    } catch (error) {
      console.error('Negotiation error:', error);
    }
  };

  try {
    await attachLocalTracks(currentPeer);
  } catch (error) {
    console.error('Error accessing media devices:', error);
    alert('Could not access camera/microphone. Please check permissions.');
    cleanupConnection();
    showLookingMessage();
    return;
  }
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

showLookingMessage();
requestMatch();

socket.on('disconnect', () => {
  cleanupConnection();
  clearChat();
  showLookingMessage();
});

socket.on('waiting', ({ roomId, type: nextType }) => {
  console.log('[waiting]', { roomId, type: nextType });
  roomid = roomId;
  type = nextType;
  isMatching = true;
  refreshConnectionState();
  showLookingMessage();
});

socket.on('match-found', (payload) => {
  beginMatch(payload).catch((error) => {
    console.error('Failed to start match:', error);
    cleanupConnection();
    showLookingMessage();
  });
});

socket.on('partner-left', () => {
  console.log('[partner-left]', { roomId: roomid });
  cleanupConnection();
  clearChat();
  showLookingMessage();
  requestMatch(500);
});

socket.on('sdp:reply', async ({ sdp, from, roomId }) => {
  try {
    if (!peer || from !== remoteSocket || roomId !== roomid) return;
    console.log('[sdp-reply]', { roomId, from, type });

    await peer.setRemoteDescription(new RTCSessionDescription(sdp));
    await flushPendingIceCandidates(peer);

    if (type === 'p2') {
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      socket.emit('sdp:send', {
        sdp: peer.localDescription,
        to: remoteSocket,
        roomId: roomid,
      });
    }
  } catch (error) {
    console.error('SDP error:', error);
  }
});

socket.on('ice:reply', async ({ candidate, from, roomId }) => {
  try {
    if (!peer || from !== remoteSocket || roomId !== roomid || !candidate) return;
    console.log('[ice-reply]', { roomId, from });

    if (peer.remoteDescription) {
      await peer.addIceCandidate(candidate);
      return;
    }

    pendingIceCandidates.push(candidate);
  } catch (error) {
    console.error('ICE error:', error);
  }
});

socket.on('get-message', (message) => {
  console.log('[message-received]', { roomId: roomid });
  addMessageToChat(message, 'received');
});

skipButton.addEventListener('click', () => {
  if (!roomid) return;
  console.log('[skip-click]', { roomId: roomid });
  socket.emit('skip', { roomId: roomid });
  cleanupConnection();
  clearChat();
  showLookingMessage();
  requestMatch(200);
});

button.onclick = () => {
  const inputBox = document.querySelector('input');
  const message = inputBox.value.trim();
  if (!message || !isConnected || !roomid) return;

  socket.emit('send-message', { message, roomId: roomid });
  addMessageToChat(message, 'sent');
  inputBox.value = '';
};

document.querySelector('input').addEventListener('keypress', (event) => {
  if (event.key === 'Enter') {
    button.click();
  }
});

document.getElementById('toggle-video').onclick = () => {
  const stream = myVideo.srcObject;
  const videoTrack = stream?.getVideoTracks()[0];
  if (!videoTrack) return;

  videoTrack.enabled = !videoTrack.enabled;
  const btn = document.getElementById('toggle-video');
  btn.classList.toggle('active', videoTrack.enabled);
  btn.classList.toggle('inactive', !videoTrack.enabled);
};

document.getElementById('toggle-audio').onclick = () => {
  const stream = myVideo.srcObject;
  const audioTrack = stream?.getAudioTracks()[0];
  if (!audioTrack) return;

  audioTrack.enabled = !audioTrack.enabled;
  const btn = document.getElementById('toggle-audio');
  btn.classList.toggle('active', audioTrack.enabled);
  btn.classList.toggle('inactive', !audioTrack.enabled);
};

function stopLocalStream() {
  if (!localStream) return;
  localStream.getTracks().forEach((track) => track.stop());
  localStream = null;
  myVideo.srcObject = null;
}

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
