// chat.js: Neumorphic AI Chatbot Widget Logic
const chatToggle = document.getElementById('chat-toggle');
const chatContainer = document.getElementById('chat-container');
const chatClose = document.getElementById('chat-close');
const chatBody = document.getElementById('chat-body');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const chatRecord = document.getElementById('chat-record');

let chatOpen = false;
let sessionId = null;
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;
let recordTimeout = null;

function toggleChat() {
  chatOpen = !chatOpen;
  chatContainer.classList.toggle('hidden', !chatOpen);
  if (chatOpen) {
    startNewSession();
  }
}

function closeChat() {
  chatOpen = false;
  chatContainer.classList.add('hidden');
}

chatToggle.addEventListener('click', () => {
  if (!chatOpen) {
    toggleChat();
  } else {
    closeChat();
  }
});

chatClose.addEventListener('click', closeChat);

function startNewSession() {
  sessionId = Date.now() + '-' + Math.floor(Math.random() * 10000);
  chatBody.innerHTML = '';
  addBotMessage("Hi! I'm a chat bot. How can I help you?");
}

function addMessage(text, sender = 'user') {
  const msgDiv = document.createElement('div');
  msgDiv.className = `message ${sender}`;
  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  avatar.innerHTML = sender === 'bot' ? '🤖' : '🧑';
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;
  msgDiv.appendChild(avatar);
  msgDiv.appendChild(bubble);
  chatBody.appendChild(msgDiv);
  chatBody.scrollTop = chatBody.scrollHeight;
}

function addBotMessage(text) {
  addMessage(text, 'bot');
}

chatForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const userMsg = chatInput.value.trim();
  if (!userMsg) return;
  addMessage(userMsg, 'user');
  chatInput.value = '';
  addBotMessage('...'); // Loading indicator
  try {
    const resp = await fetch('/.netlify/functions/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: userMsg })
    });
    const data = await resp.json();
    // Remove the loading message
    const lastBotMsg = chatBody.querySelector('.message.bot:last-child');
    if (lastBotMsg && lastBotMsg.querySelector('.bubble').textContent === '...') {
      lastBotMsg.remove();
    }
    if (data.answer) {
      addBotMessage(data.answer);
    } else {
      addBotMessage('Sorry, I could not find an answer.');
    }
  } catch (err) {
    const lastBotMsg = chatBody.querySelector('.message.bot:last-child');
    if (lastBotMsg && lastBotMsg.querySelector('.bubble').textContent === '...') {
      lastBotMsg.remove();
    }
    addBotMessage('Sorry, something went wrong.');
  }
});

chatRecord.addEventListener('click', async () => {
  if (isRecording) {
    mediaRecorder.stop();
    chatRecord.innerHTML = '<i class="fas fa-microphone"></i>';
    isRecording = false;
    if (recordTimeout) clearTimeout(recordTimeout);
  } else {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert('Voice input not supported in this browser.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream);
      audioChunks = [];
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunks.push(e.data);
      };
      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        console.log('Audio blob size (bytes):', audioBlob.size); // DEBUG
        if (audioBlob.size > 24 * 1024 * 1024) {
          addBotMessage('Recording too long! Please keep voice input under 10 seconds.');
          return;
        }
        const formData = new FormData();
        formData.append('audio', audioBlob, 'voice.webm');
        addBotMessage('Analyzing... Please wait while your audio is transcribed.');
        try {
          const resp = await fetch('/api/voice-to-text', {
            method: 'POST',
            body: formData
          });
          const data = await resp.json();
          // Remove the 'Analyzing...' message
          const lastBotMsg = chatBody.querySelector('.message.bot:last-child');
          if (lastBotMsg && lastBotMsg.querySelector('.bubble').textContent.startsWith('Analyzing')) {
            lastBotMsg.remove();
          }
          if (data.text) {
            // Send transcribed text as chat message
            chatInput.value = data.text;
            chatForm.dispatchEvent(new Event('submit'));
          } else {
            addBotMessage('Sorry, could not transcribe audio.');
          }
        } catch (err) {
          const lastBotMsg = chatBody.querySelector('.message.bot:last-child');
          if (lastBotMsg && lastBotMsg.querySelector('.bubble').textContent.startsWith('Analyzing')) {
            lastBotMsg.remove();
          }
          addBotMessage('Sorry, something went wrong with voice input.');
        }
      };
      mediaRecorder.start();
      chatRecord.innerHTML = '<i class="fas fa-stop"></i>';
      isRecording = true;
      // Auto-stop after 10 seconds
      recordTimeout = setTimeout(() => {
        if (isRecording) {
          mediaRecorder.stop();
          chatRecord.innerHTML = '<i class="fas fa-microphone"></i>';
          isRecording = false;
        }
      }, 10000);
    } catch (err) {
      alert('Could not start voice recording: ' + err.message);
    }
  }
});

// Optional: open chat if user presses Alt+C
window.addEventListener('keydown', (e) => {
  if (e.altKey && e.key.toLowerCase() === 'c') {
    toggleChat();
  }
});
