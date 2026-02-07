import React, { useState, useEffect, useRef, useCallback } from 'react';
import { getDistance } from './navUtils';
import './ChatPanel.css';

const WELCOME_MESSAGE = {
  role: 'assistant',
  content: "Hi! Tell me where you want to go in Manhattan and I'll find you a safe route."
};

const EXAMPLE_PROMPTS = [
  "Walk from Times Square to Penn Station at 11 PM",
  "Central Park to Wall Street, morning rush hour",
  "I'm alone walking from SoHo to Grand Central at night"
];

function TypingIndicator() {
  return (
    <div className="typing-indicator">
      <span></span>
      <span></span>
      <span></span>
    </div>
  );
}

function ChatMessage({ message }) {
  if (message.role === 'user') {
    return <div className="chat-msg user">{message.content}</div>;
  }

  if (message.role === 'briefing') {
    const renderLine = (line, lineKey) => {
      const parts = [];
      let lastIndex = 0;
      const boldRegex = /\*\*(.+?)\*\*/g;
      let match;
      while ((match = boldRegex.exec(line)) !== null) {
        if (match.index > lastIndex) {
          parts.push(line.slice(lastIndex, match.index));
        }
        parts.push(<strong key={`${lineKey}-b-${match.index}`}>{match[1]}</strong>);
        lastIndex = boldRegex.lastIndex;
      }
      if (lastIndex < line.length) {
        parts.push(line.slice(lastIndex));
      }
      return parts.length > 0 ? parts : [line];
    };

    const renderBriefing = (text) => {
      return text.split('\n\n').map((block, i) => {
        const lines = block.split('\n');
        return (
          <p key={i} className="briefing-text">
            {lines.map((line, j) => (
              <React.Fragment key={j}>
                {j > 0 && <br />}
                {renderLine(line, `${i}-${j}`)}
              </React.Fragment>
            ))}
          </p>
        );
      });
    };

    return (
      <div className="chat-msg briefing">
        <div className="briefing-header">
          Safety Briefing
        </div>
        <div className="briefing-body">
          {renderBriefing(message.content)}
        </div>
        {message.metrics && (
          <div className="briefing-stats">
            <span className="briefing-stat green">
              -{message.metrics.reduction_in_risk_pct}% risk
            </span>
            <span className="briefing-stat orange">
              +{Math.round(message.metrics.extra_time_seconds)}s time
            </span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`chat-msg assistant ${message.isError ? 'error' : ''}`}>
      {message.content}
    </div>
  );
}

// Browser Speech APIs
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const synth = window.speechSynthesis;

// Pick a random item from an array (keeps responses from sounding scripted)
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Select the most natural-sounding voice available
let preferredVoice = null;
const loadVoice = () => {
  if (!synth) return;
  const voices = synth.getVoices();
  // Prefer Google voices (much more natural on Chrome), then any en-US female voice
  preferredVoice =
    voices.find(v => v.name.includes('Google US English')) ||
    voices.find(v => v.name.includes('Google UK English Female')) ||
    voices.find(v => v.lang === 'en-US' && v.name.toLowerCase().includes('female')) ||
    voices.find(v => v.lang === 'en-US') ||
    voices.find(v => v.lang.startsWith('en')) ||
    null;
};
if (synth) {
  loadVoice();
  synth.onvoiceschanged = loadVoice;
}

export default function ChatPanel({ onRouteReceived, onStartNavigation, navContext }) {
  const [messages, setMessages] = useState([WELCOME_MESSAGE]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showExamples, setShowExamples] = useState(true);
  const [hasRoute, setHasRoute] = useState(false);

  // Voice call state
  const [callActive, setCallActive] = useState(false);
  // 'idle' | 'listening' | 'processing' | 'speaking'
  const [callState, setCallState] = useState('idle');
  const [transcript, setTranscript] = useState('');
  const [callDuration, setCallDuration] = useState(0);

  const messagesEndRef = useRef(null);
  const recognitionRef = useRef(null);
  const callActiveRef = useRef(false);
  const durationRef = useRef(null);

  // Navigation-aware voice refs
  const navContextRef = useRef(null);
  const lastAlertedStepRef = useRef(-1);
  const turnAlertPendingRef = useRef(null);
  const speakingUtteranceRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      endCall();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep navContext ref in sync for async access
  useEffect(() => {
    navContextRef.current = navContext || null;
  }, [navContext]);

  // Call duration timer
  useEffect(() => {
    if (callActive) {
      setCallDuration(0);
      durationRef.current = setInterval(() => {
        setCallDuration(d => d + 1);
      }, 1000);
    } else {
      if (durationRef.current) clearInterval(durationRef.current);
      setCallDuration(0);
    }
    return () => {
      if (durationRef.current) clearInterval(durationRef.current);
    };
  }, [callActive]);

  const formatCallTime = (s) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  // --- TTS (tracks current utterance for mid-speech interruption) ---
  // Chrome bug: SpeechSynthesis hangs after ~15s. Workaround: periodic pause/resume.
  // style: 'normal' | 'alert' | 'casual' | 'excited' — adjusts rate/pitch for human feel
  const speak = useCallback((text, style = 'normal') => {
    return new Promise((resolve) => {
      if (!synth) { resolve(); return; }
      synth.cancel();
      const clean = text.replace(/\*\*(.+?)\*\*/g, '$1');
      const utterance = new SpeechSynthesisUtterance(clean);

      // Use the best natural voice available
      if (preferredVoice) utterance.voice = preferredVoice;
      utterance.lang = 'en-US';

      // Vary rate/pitch by style for natural prosody
      switch (style) {
        case 'alert':   utterance.rate = 1.15; utterance.pitch = 1.1;  break; // urgent, slightly faster
        case 'casual':  utterance.rate = 0.95; utterance.pitch = 1.0;  break; // relaxed, slightly slower
        case 'excited': utterance.rate = 1.1;  utterance.pitch = 1.15; break; // upbeat
        default:        utterance.rate = 1.0;  utterance.pitch = 1.0;  break; // natural default
      }

      let resumeTimer = null;
      const safetyTimeout = setTimeout(() => {
        if (resumeTimer) clearInterval(resumeTimer);
        speakingUtteranceRef.current = null;
        synth.cancel();
        resolve();
      }, 30000);

      utterance.onstart = () => {
        resumeTimer = setInterval(() => {
          if (synth.speaking) { synth.pause(); synth.resume(); }
        }, 10000);
      };

      speakingUtteranceRef.current = utterance;
      utterance.onend = () => {
        clearTimeout(safetyTimeout);
        if (resumeTimer) clearInterval(resumeTimer);
        speakingUtteranceRef.current = null;
        resolve();
      };
      utterance.onerror = () => {
        clearTimeout(safetyTimeout);
        if (resumeTimer) clearInterval(resumeTimer);
        speakingUtteranceRef.current = null;
        resolve();
      };
      synth.speak(utterance);
    });
  }, []);

  // Split long text into sentence chunks to avoid Chrome TTS cutoff
  const speakLong = useCallback(async (text) => {
    // Split on sentence boundaries, keep chunks reasonable
    const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text];
    let chunk = '';
    for (const sentence of sentences) {
      if ((chunk + sentence).length > 150 && chunk) {
        await speak(chunk.trim());
        if (!callActiveRef.current) return;
        chunk = sentence;
      } else {
        chunk += sentence;
      }
    }
    if (chunk.trim()) await speak(chunk.trim());
  }, [speak]);

  // --- STT ---
  const listen = useCallback(() => {
    return new Promise((resolve, reject) => {
      if (!SpeechRecognition) {
        reject(new Error('Speech recognition not supported'));
        return;
      }

      // Prevent double-resolve (onresult + onend can both fire)
      let resolved = false;
      const safeResolve = (val) => {
        if (!resolved) { resolved = true; resolve(val); }
      };
      const safeReject = (val) => {
        if (!resolved) { resolved = true; reject(val); }
      };

      const recognition = new SpeechRecognition();
      recognition.lang = 'en-US';
      recognition.interimResults = true;
      recognition.continuous = false;
      recognition.maxAlternatives = 1;

      // Safety timeout: resolve empty after 15s if nothing happens
      const timeout = setTimeout(() => {
        try { recognition.stop(); } catch { /* ignore */ }
        safeResolve('');
      }, 15000);

      recognition.onresult = (event) => {
        const current = event.results[event.results.length - 1];
        setTranscript(current[0].transcript);
        if (current.isFinal) {
          clearTimeout(timeout);
          safeResolve(current[0].transcript);
        }
      };

      recognition.onerror = (e) => {
        clearTimeout(timeout);
        if (e.error === 'no-speech' || e.error === 'aborted') {
          safeResolve('');
        } else {
          safeReject(e);
        }
      };

      recognition.onend = () => {
        clearTimeout(timeout);
        safeResolve('');
      };

      recognitionRef.current = recognition;
      try {
        recognition.start();
      } catch {
        clearTimeout(timeout);
        safeResolve('');
      }
    });
  }, []);

  // --- Turn alert phrases (lots of variety so it never sounds robotic) ---
  const turnAlertPhrases = [
    (label, dist) => `Oh sorry to interrupt, but there's a ${label} coming up in like ${dist} meters.`,
    (label, dist) => `Hey, quick thing, you've got a ${label} in about ${dist} meters.`,
    (label, dist) => `Oh wait, ${label} coming up, about ${dist} meters ahead.`,
    (label, dist) => `So, heads up, ${label} in like ${dist} meters, okay?`,
    (label, dist) => `Just wanted to let you know, there's a ${label} about ${dist} meters from here.`,
    (label, dist) => `Real quick, ${label} ahead, maybe ${dist} meters or so.`,
    (label, dist) => `By the way, you're gonna want to ${label} in about ${dist} meters.`,
    (label, dist) => `Oh and, ${label} coming up pretty soon, like ${dist} meters.`,
  ];

  // --- Drain any pending turn alert ---
  const drainTurnAlert = useCallback(async () => {
    const alert = turnAlertPendingRef.current;
    if (alert) {
      turnAlertPendingRef.current = null;
      setCallState('speaking');
      await speak(alert, 'alert');
    }
  }, [speak]);

  // --- Turn alert monitoring interval ---
  useEffect(() => {
    if (!callActive || !navContext?.isNavigating) {
      lastAlertedStepRef.current = -1;
      return;
    }

    const monitor = setInterval(() => {
      const ctx = navContextRef.current;
      if (!ctx || !ctx.currentPosition || !ctx.instructions?.length) return;

      const nextStepIdx = ctx.currentStep + 1;

      // Check for arrival
      if (ctx.currentStep === ctx.instructions.length - 1) {
        const destDist = getDistance(ctx.currentPosition, ctx.instructions[ctx.instructions.length - 1].coord);
        if (destDist < 20 && lastAlertedStepRef.current !== ctx.instructions.length) {
          lastAlertedStepRef.current = ctx.instructions.length;
          turnAlertPendingRef.current = pick([
            "Hey, you made it! You're right at your destination. Nice one!",
            "And, we're here! That's your stop. You did great!",
            "Okay, that's it, you've arrived! Look around, this is the place.",
            "We made it! You're at your destination. That wasn't too bad, right?",
          ]);
          if (synth && speakingUtteranceRef.current) synth.cancel();
        }
        return;
      }

      if (nextStepIdx >= ctx.instructions.length) return;
      if (nextStepIdx <= lastAlertedStepRef.current) return;

      const nextInstr = ctx.instructions[nextStepIdx];
      const dist = getDistance(ctx.currentPosition, nextInstr.coord);

      if (dist < 50) {
        lastAlertedStepRef.current = nextStepIdx;
        const label = nextInstr.label.toLowerCase();
        let alertText;
        if (label.includes('arrive')) {
          alertText = pick([
            "Oh wait, you're almost there! Your destination is just ahead.",
            "Hey, look up! You're like right there, just a few more steps.",
            "Okay, we're super close now, your spot is just ahead.",
          ]);
        } else {
          const phrase = turnAlertPhrases[Math.floor(Math.random() * turnAlertPhrases.length)];
          alertText = phrase(label, Math.round(dist));
        }
        turnAlertPendingRef.current = alertText;
        // Interrupt current speech if active
        if (synth && speakingUtteranceRef.current) synth.cancel();
      }
    }, 500);

    return () => clearInterval(monitor);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callActive, navContext?.isNavigating]);

  // --- Answer navigation questions locally ---
  const handleNavQuestion = useCallback((text) => {
    const ctx = navContextRef.current;
    if (!ctx || !ctx.isNavigating || !ctx.instructions?.length || !ctx.currentPosition) return null;

    const lower = text.toLowerCase();
    const navPatterns = [
      /\b(left|right|straight)\s*(or)\b/,
      /\bwhich\s*(way|direction|side)\b/,
      /\bwhere\s*(do i|should i|to)\s*(go|turn)\b/,
      /\bwhat('s| is)\s*(the\s*)?(next\s*)?turn\b/,
      /\bam i\s*(going|headed)\b/,
      /\bhow\s*far\b/,
      /\bwhen\s*(do i|should i)\s*turn\b/,
      /\bare we\s*there\b/,
      /\balmost\s*there\b/,
      /\bnext\s*(turn|step|move)\b/,
      /\bdo i\s*turn\b/,
      /\bshould i\s*(keep|go)\s*straight\b/,
    ];

    if (!navPatterns.some(p => p.test(lower))) return null;

    const nextInstr = ctx.instructions[ctx.currentStep + 1];
    const pos = ctx.currentPosition;

    // "how far" queries
    if (/\bhow\s*far\b/.test(lower)) {
      if (lower.includes('destination') || lower.includes('there')) {
        const destCoord = ctx.instructions[ctx.instructions.length - 1].coord;
        const dist = getDistance(pos, destCoord);
        if (dist < 100) return pick([
          "Oh you're super close, less than a hundred meters!",
          "Almost there, like less than a hundred meters, you can probably see it!",
        ]);
        return pick([
          `So you've got about ${Math.round(dist)} meters left. Not too bad, keep it up!`,
          `About ${Math.round(dist)} meters to go. You're making good time though!`,
          `Hmm, looks like roughly ${Math.round(dist)} meters still. We'll get there!`,
        ]);
      }
      if (nextInstr) {
        const dist = getDistance(pos, nextInstr.coord);
        return pick([
          `Your next turn is about ${Math.round(dist)} meters ahead, it's a ${nextInstr.label.toLowerCase()}.`,
          `About ${Math.round(dist)} meters until you need to ${nextInstr.label.toLowerCase()}.`,
        ]);
      }
    }

    // "are we there yet"
    if (/\bare we\s*there\b/.test(lower) || /\balmost\s*there\b/.test(lower)) {
      const destCoord = ctx.instructions[ctx.instructions.length - 1].coord;
      const dist = getDistance(pos, destCoord);
      if (dist < 50) return pick([
        "Yeah! You're basically there, just a few more steps!",
        "Pretty much! Look around, you should be right at it.",
      ]);
      if (dist < 200) return pick([
        "Almost! You're really close now, less than 200 meters.",
        "So close! Just a little bit more, under 200 meters.",
      ]);
      return pick([
        `Not quite yet, about ${Math.round(dist)} meters still. But we're getting there!`,
        `Still got about ${Math.round(dist)} meters. Hang tight, I'll let you know!`,
        `Hmm, about ${Math.round(dist)} meters to go. We'll be there before you know it!`,
      ]);
    }

    // Direction / turn queries ("left or right?", "which way?", "do I turn?")
    if (nextInstr) {
      const dist = getDistance(pos, nextInstr.coord);
      const label = nextInstr.label.toLowerCase();
      return pick([
        `So your next move is to ${label}, it's about ${Math.round(dist)} meters ahead. For now just keep going straight.`,
        `You're gonna ${label} in about ${Math.round(dist)} meters. Just stay on this path for now.`,
        `Coming up you'll need to ${label}, like ${Math.round(dist)} meters from here. I'll remind you when it's time.`,
      ]);
    }

    // On last step
    const currentInstr = ctx.instructions[ctx.currentStep];
    if (currentInstr && currentInstr.label.includes('Arrive')) {
      return pick([
        "You're right at your destination! Look around, this should be it.",
        "This is it! You've arrived. Nice work getting here safely!",
      ]);
    }

    return pick([
      "Just keep going straight for now, I'll tell you when there's a turn coming up.",
      "You're good, just keep heading the same way. I've got my eye on the route.",
      "Straight ahead for now! I'll give you a heads up before any turns.",
    ]);
  }, []);

  // --- Core call loop ---
  const callLoop = useCallback(async (isFirst) => {
    if (!callActiveRef.current) return;

    // Speak greeting on first iteration
    if (isFirst) {
      setCallState('speaking');
      const ctx = navContextRef.current;
      if (ctx?.isNavigating) {
        await speak(pick([
          "Hey! I can see you're already moving. I'll keep an eye on your route and let you know about turns. What's going on?",
          "Oh hey, looks like you're already on your way! I'm here, I'll watch the turns for you. Anything you wanna talk about?",
          "Hey there! You're already navigating, nice. I'll jump in when there's a turn coming up. What's up?",
        ]), 'casual');
      } else {
        await speak(pick([
          "Hey! So, where are you headed? Just tell me your start and end and I'll figure out the safest way to get you there.",
          "Hey there! Tell me where you wanna go and I'll find you a safe route. Like, just say something like walk from Times Square to Penn Station.",
          "Hi! I'm here to help you get around safely. Where are you going tonight?",
        ]), 'casual');
      }
      if (!callActiveRef.current) return;
      await drainTurnAlert();
      if (!callActiveRef.current) return;
    }

    // Drain any pending turn alert before listening
    await drainTurnAlert();
    if (!callActiveRef.current) return;

    // Listen
    setCallState('listening');
    setTranscript('');
    let userText = '';
    try {
      userText = await listen();
    } catch {
      if (callActiveRef.current) {
        setCallState('speaking');
        await speak(pick([
          "Sorry, I didn't catch that. Could you say it again?",
          "Hmm, I couldn't hear you. Mind repeating that?",
          "I missed that, can you try again?",
        ]), 'casual');
        if (callActiveRef.current) callLoop(false);
      }
      return;
    }

    if (!callActiveRef.current) return;

    // Drain alert after listening
    await drainTurnAlert();
    if (!callActiveRef.current) return;

    userText = userText.trim();
    if (!userText) {
      await new Promise(r => setTimeout(r, 500));
      if (callActiveRef.current) callLoop(false);
      return;
    }

    // Check for end-call voice commands
    const lower = userText.toLowerCase();
    if (lower.includes('end call') || lower.includes('hang up') || lower.includes('stop call') || lower === 'bye' || lower === 'goodbye') {
      setCallState('speaking');
      await speak(pick([
        "Alright, stay safe out there! Talk to you later.",
        "Okay, take care! Let me know if you need anything. Bye!",
        "See ya! Be safe out there, okay?",
      ]), 'casual');
      endCall();
      return;
    }

    // Check for navigation voice commands (auto-start simulation)
    if (lower.includes('navigate safest') || lower.includes('start safest') || lower.includes('use safest') || lower.includes('safest route') || lower === 'safest') {
      setCallState('speaking');
      await speak(pick([
        "Alright, let's do the safe route! I'll guide you through it and give you a heads up before every turn.",
        "Going with the safest option, good call! I'll tell you when to turn, just follow my lead.",
        "On it! Starting the safest route now. Just keep walking and I'll handle the directions.",
      ]), 'excited');
      if (onStartNavigation) onStartNavigation('safest', 'sim');
      if (callActiveRef.current) callLoop(false);
      return;
    }
    if (lower.includes('navigate fastest') || lower.includes('start fastest') || lower.includes('use fastest') || lower.includes('fastest route') || lower === 'fastest') {
      setCallState('speaking');
      await speak(pick([
        "Speed it is! Taking the fastest route. I'll let you know about every turn.",
        "Alright, fastest route coming up! I'll keep you posted as we go.",
        "Going fast, I like it! Starting navigation now, I'll guide you through.",
      ]), 'excited');
      if (onStartNavigation) onStartNavigation('fastest', 'sim');
      if (callActiveRef.current) callLoop(false);
      return;
    }

    // Check for local navigation question (instant, no backend needed)
    const navAnswer = handleNavQuestion(userText);
    if (navAnswer) {
      setMessages(prev => [...prev, { role: 'user', content: userText }]);
      setMessages(prev => [...prev, { role: 'assistant', content: navAnswer }]);
      setCallState('speaking');
      await speak(navAnswer, 'casual');
      await drainTurnAlert();
      if (callActiveRef.current) callLoop(false);
      return;
    }

    // Quick acknowledgment before processing (makes it feel like the AI heard you)
    setCallState('speaking');
    await speak(pick([
      "Okay, let me look that up for you.",
      "Hmm, give me one sec.",
      "Alright, let me figure that out.",
      "Sure, checking on that now.",
      "Got it, one moment.",
    ]), 'casual');

    // Process with backend
    setCallState('processing');
    setMessages(prev => [...prev, { role: 'user', content: userText }]);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userText, user_hour: new Date().getHours() })
      });
      const data = await res.json();

      if (!callActiveRef.current) return;

      if (data.status === 'success') {
        setMessages(prev => [
          ...prev,
          { role: 'assistant', content: data.ai_summary },
          { role: 'briefing', content: data.safety_briefing, metrics: data.route_data.metrics }
        ]);
        onRouteReceived(
          data.route_data,
          data.parsed.start_coords,
          data.parsed.end_coords,
          data.parsed.hour,
          data.parsed.beta
        );
        setHasRoute(true);

        // Speak the summary + briefing (split long text to avoid Chrome TTS freeze)
        setCallState('speaking');
        await speak(pick([
          "Okay so here's what I found.",
          "Alright, I've got your routes.",
          "Cool, so I checked that out for you.",
        ]), 'casual');
        if (!callActiveRef.current) return;
        await speakLong(data.ai_summary);
        if (!callActiveRef.current) return;
        await drainTurnAlert();
        await speakLong(data.safety_briefing);
        if (!callActiveRef.current) return;
        await drainTurnAlert();
        await speak(pick([
          "So I've got two routes for you. Do you want the safest one or the fastest? Just say the word.",
          "Anyway, you can go with the safest route or the fastest one. Which sounds better?",
          "So what do you think, safest or fastest route? Both are good options honestly.",
        ]), 'casual');
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: data.message, isError: true }]);
        setCallState('speaking');
        await speak(data.message || pick([
          "Hmm, I'm not sure I understood that. Could you tell me like, where you're starting from and where you wanna go?",
          "I didn't quite get that. Try something like, walk from Times Square to Central Park.",
          "Sorry, I'm a bit confused. Can you give me your starting point and destination?",
        ]), 'casual');
      }
    } catch {
      setCallState('speaking');
      await speak(pick([
        "Ugh, I can't connect to the server right now. Can you try again in a sec?",
        "Hmm, something went wrong on my end. Let's try that again.",
        "Sorry about that, the connection dropped. Mind saying that again?",
      ]), 'casual');
    }

    await drainTurnAlert();
    if (callActiveRef.current) {
      callLoop(false);
    }
  }, [speak, speakLong, listen, onRouteReceived, onStartNavigation, hasRoute, drainTurnAlert, handleNavQuestion]);

  // --- Start / End call ---
  const startCall = () => {
    if (!SpeechRecognition) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Voice is not supported in this browser. Please use Chrome.',
        isError: true
      }]);
      return;
    }
    setCallActive(true);
    callActiveRef.current = true;
    callLoop(true);
  };

  const endCall = () => {
    callActiveRef.current = false;
    setCallActive(false);
    setCallState('idle');
    setTranscript('');
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch { /* ignore */ }
    }
    if (synth) synth.cancel();
  };

  // --- Text chat (non-voice) ---
  const sendMessage = async (text) => {
    const userMsg = (text || input).trim();
    if (!userMsg || isLoading) return;

    setInput('');
    setShowExamples(false);
    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setIsLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMsg, user_hour: new Date().getHours() })
      });
      const data = await res.json();

      if (data.status === 'success') {
        setMessages(prev => [
          ...prev,
          { role: 'assistant', content: data.ai_summary },
          { role: 'briefing', content: data.safety_briefing, metrics: data.route_data.metrics }
        ]);
        onRouteReceived(
          data.route_data,
          data.parsed.start_coords,
          data.parsed.end_coords,
          data.parsed.hour,
          data.parsed.beta
        );
        setHasRoute(true);
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: data.message, isError: true }]);
      }
    } catch {
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: 'Could not connect to the backend. Make sure the Flask server is running on port 5000.', isError: true }
      ]);
    }
    setIsLoading(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // --- Call overlay ---
  if (callActive) {
    return (
      <div className="chat-panel">
        <div className="call-overlay">
          {/* Call header */}
          <div className="call-header">
            <span className="call-label">SafePath AI</span>
            <span className="call-timer">{formatCallTime(callDuration)}</span>
          </div>

          {/* Animated orb */}
          <div className={`call-orb ${callState}`}>
            <div className="call-orb-inner">
              {callState === 'listening' && '🎙️'}
              {callState === 'processing' && '🧠'}
              {callState === 'speaking' && '🔊'}
              {callState === 'idle' && '📞'}
            </div>
            <div className="call-ring ring-1"></div>
            <div className="call-ring ring-2"></div>
            <div className="call-ring ring-3"></div>
          </div>

          {/* State label */}
          <div className="call-state-label">
            {callState === 'listening' && 'Listening...'}
            {callState === 'processing' && 'Thinking...'}
            {callState === 'speaking' && 'Speaking...'}
            {callState === 'idle' && 'Connecting...'}
          </div>

          {/* Live transcript */}
          {transcript && callState === 'listening' && (
            <div className="call-transcript">"{transcript}"</div>
          )}

          {/* Recent message preview */}
          {messages.length > 1 && (
            <div className="call-last-msg">
              {messages[messages.length - 1].content?.slice(0, 120)}
              {messages[messages.length - 1].content?.length > 120 ? '...' : ''}
            </div>
          )}

          {/* Nav buttons in call mode */}
          {hasRoute && onStartNavigation && (
            <div className="call-nav-hint">
              Say "navigate safest" or "navigate fastest"
            </div>
          )}

          {/* End call button */}
          <button className="call-end-btn" onClick={endCall}>
            <span className="call-end-icon">📞</span>
            End Call
          </button>
        </div>
      </div>
    );
  }

  // --- Normal text chat UI ---
  return (
    <div className="chat-panel">
      <div className="chat-messages">
        {messages.map((msg, i) => (
          <ChatMessage key={i} message={msg} />
        ))}
        {isLoading && <TypingIndicator />}
        <div ref={messagesEndRef} />
      </div>

      {showExamples && messages.length <= 1 && (
        <div className="chat-examples">
          <div className="chat-examples-title">Try these</div>
          {EXAMPLE_PROMPTS.map((prompt, i) => (
            <button
              key={i}
              className="chat-example-btn"
              onClick={() => sendMessage(prompt)}
            >
              "{prompt}"
            </button>
          ))}
        </div>
      )}

      {hasRoute && onStartNavigation && (
        <div className="chat-nav-buttons">
          <button className="chat-nav-btn safest" onClick={() => onStartNavigation('safest')}>
            🛡️ Navigate Safest Route
          </button>
          <button className="chat-nav-btn fastest" onClick={() => onStartNavigation('fastest')}>
            ⚡ Navigate Fastest Route
          </button>
        </div>
      )}

      <div className="chat-input-bar">
        <button
          className="voice-call-btn"
          onClick={startCall}
          disabled={isLoading}
          title="Start voice call"
        >
          📞
        </button>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Where do you want to go?"
          disabled={isLoading}
        />
        <button
          className="chat-send-btn"
          onClick={() => sendMessage()}
          disabled={isLoading || !input.trim()}
        >
          Send
        </button>
      </div>
    </div>
  );
}
