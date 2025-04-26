import { io } from 'socket.io-client';

// Global state
let peer;
const myVideo = document.getElementById('my-video');
const strangerVideo = document.getElementById('video');
const button = document.getElementById('send');
let remoteSocket;
let type;
let roomid;

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
        };
      }
    })
    .catch(ex => {
      console.error('Error accessing media devices: ', ex);
      alert('Could not access media devices. Please check permissions.');
    });
}

// Connect to server
const socket = io('http://localhost:8000');

// On disconnect
socket.on('disconnected', () => {
  alert('Stranger has disconnected.');
  location.href = '/?disconnect';
});

// --------- WebRTC Logic ---------

// Start session (get user type)
socket.emit('start', (person) => {
  type = person;
});

// Remote socket received
socket.on('remote-socket', (id) => {
  remoteSocket = id;

  document.querySelector('.modal').style.display = 'none'; // Hide modal on connection
  
  peer = new RTCPeerConnection();

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
      alert('ICE Connection failed');
      // Reconnect or cleanup actions
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
    if (candidate) {
      await peer.addIceCandidate(candidate);
    }
  } catch (error) {
    console.error('Error adding ICE candidate:', error);
  }
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

  if (message !== '') {
    socket.emit('send-message', message, type, roomid);
    addMessageToChat(message, 'sent');
    inputBox.value = '';
  }
};

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
  peer.close(); // Close peer connection
  location.href = '/?disconnect';
};
