import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { GoogleGenAI, Type, Schema, Modality } from "@google/genai";
import { 
  BookOpen, Heart, Sun, ArrowLeft, Share2, Sparkles, Feather, 
  Bell, PenLine, Save, Trash2, Wind, Shield, Anchor, Zap, Coffee, 
  Smile, UserPlus, Mountain, CloudRain, Lock, Clock, Menu,
  Volume2, Loader, Square, Download, X, Copy
} from "lucide-react";

// --- Types & Schema ---

interface DevotionalContent {
  title: string;
  verseReference: string;
  verseText: string;
  reflection: string;
  application: string;
  prayer: string;
}

interface SavedNote {
  id: string;
  date: string;
  topic: string;
  content: DevotionalContent;
  userNote: string;
  timestamp: number;
}

const devotionalSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING, description: "Frase curta e emocional." },
    verseReference: { type: Type.STRING, description: "Livro e Capítulo (ex: Salmos 23:1)." },
    verseText: { type: Type.STRING, description: "O texto bíblico completo." },
    reflection: { type: Type.STRING, description: "Reflexão profunda, 3 a 6 parágrafos, tom acolhedor e terapêutico." },
    application: { type: Type.STRING, description: "Uma atitude prática para o dia." },
    prayer: { type: Type.STRING, description: "Uma oração curta e direta." },
  },
  required: ["title", "verseReference", "verseText", "reflection", "application", "prayer"],
};

// --- Audio Helpers ---

function base64ToUint8Array(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number = 24000,
  numChannels: number = 1,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

// --- Icons Map for Topics ---
const topicIcons: Record<string, React.ReactNode> = {
  "Ansiedade": <Wind size={24} />,
  "Medo": <Shield size={24} />,
  "Esperança": <Anchor size={24} />,
  "Fé": <Zap size={24} />,
  "Descanso": <Coffee size={24} />,
  "Gratidão": <Heart size={24} />,
  "Perdão": <UserPlus size={24} />,
  "Confiança em Deus": <Mountain size={24} />,
  "Solidão": <CloudRain size={24} />,
  "Cansaço": <Clock size={24} />,
  "Recomeço": <Sun size={24} />,
  "Amor Próprio": <Lock size={24} />
};

// --- App Component ---

const App = () => {
  // Navigation State
  const [view, setView] = useState<"home" | "reading" | "topics" | "notes-list">("home");
  
  // Content State
  const [content, setContent] = useState<DevotionalContent | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [currentTopic, setCurrentTopic] = useState<string>("");
  const [fontSize, setFontSize] = useState<"small" | "medium" | "large">("medium");

  // Notes State
  const [userNote, setUserNote] = useState("");
  const [savedNotes, setSavedNotes] = useState<SavedNote[]>([]);

  // Notifications State
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);

  // Audio State
  const [isAudioLoading, setIsAudioLoading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);

  // Install PWA State
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showInstallBanner, setShowInstallBanner] = useState(false);

  // Load notes & Check PWA install capability
  useEffect(() => {
    const saved = localStorage.getItem("my_devotional_notes");
    if (saved) {
      setSavedNotes(JSON.parse(saved));
    }

    // Check notification permission
    if (Notification.permission === 'granted') {
      setNotificationsEnabled(true);
      checkDailyNotification();
    }
    
    // PWA Install Event Listener
    const handleBeforeInstallPrompt = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
      // Only show if user hasn't dismissed it before
      const isDismissed = localStorage.getItem("install_banner_dismissed");
      if (!isDismissed) {
        setShowInstallBanner(true);
      }
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    // Cleanup audio on unmount
    return () => {
      stopAudio();
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setShowInstallBanner(false);
    }
    setDeferredPrompt(null);
  };

  const dismissInstallBanner = () => {
    setShowInstallBanner(false);
    localStorage.setItem("install_banner_dismissed", "true");
  };

  const stopAudio = () => {
    if (audioSourceRef.current) {
      try {
        audioSourceRef.current.stop();
      } catch (e) {
        // Ignore if already stopped
      }
      audioSourceRef.current.disconnect();
      audioSourceRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    setIsPlaying(false);
    setIsAudioLoading(false);
  };

  const handlePlayAudio = async () => {
    if (!content) return;
    if (isPlaying) {
      stopAudio();
      return;
    }

    setIsAudioLoading(true);

    try {
      // 1. Prepare Text
      const textToRead = `
        ${content.title}. 
        Leitura de ${content.verseReference}.
        ${content.verseText}
        
        Reflexão.
        ${content.reflection}
        
        Aplicação Prática.
        ${content.application}
        
        Oração.
        ${content.prayer}
      `;

      // 2. Init API
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      // 3. Generate Audio
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: textToRead }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Puck' }, // Puck is usually calm/male
            },
          },
        },
      });

      // 4. Decode and Play
      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      
      if (base64Audio) {
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({sampleRate: 24000});
        audioContextRef.current = audioCtx;

        const audioBytes = base64ToUint8Array(base64Audio);
        const audioBuffer = await decodeAudioData(audioBytes, audioCtx, 24000, 1);
        
        const source = audioCtx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioCtx.destination);
        
        source.onended = () => {
          setIsPlaying(false);
          stopAudio(); // Clean up context
        };

        source.start();
        audioSourceRef.current = source;
        setIsPlaying(true);
      }

    } catch (error) {
      console.error("Error generating audio:", error);
      alert("Não foi possível gerar o áudio agora.");
    } finally {
      setIsAudioLoading(false);
    }
  };

  const requestNotificationPermission = async () => {
    if (!("Notification" in window)) {
      alert("Este navegador não suporta notificações.");
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission === "granted") {
      setNotificationsEnabled(true);
      new Notification("Meu Terapeuta: DEUS", {
        body: "Notificações ativadas! Você receberá uma palavra de ânimo pela manhã.",
        icon: "https://images.unsplash.com/photo-1500964757637-c85e8a162699?q=80&w=192&auto=format&fit=crop"
      });
    }
  };

  const checkDailyNotification = () => {
    const now = new Date();
    const hours = now.getHours();
    const todayStr = now.toLocaleDateString();
    const lastNotif = localStorage.getItem('last_notification_date');

    if (hours >= 6 && hours < 12 && lastNotif !== todayStr) {
      new Notification("Bom dia! ☀️", {
        body: "Deus tem uma palavra para o seu coração hoje. Tire um momento para ouvir.",
        icon: "https://images.unsplash.com/photo-1500964757637-c85e8a162699?q=80&w=192&auto=format&fit=crop"
      });
      localStorage.setItem('last_notification_date', todayStr);
    }
  };

  const handleShare = async () => {
    if (!content) return;
    const shareText = `*${content.title}*\n\n"${content.verseText}"\n_${content.verseReference}_\n\nLeia a reflexão completa no app *Meu Terapeuta: DEUS*`;
    
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Meu Terapeuta: DEUS',
          text: shareText,
          url: window.location.href,
        });
      } catch (err) {
        console.log('Error sharing:', err);
      }
    } else {
      // Fallback
      navigator.clipboard.writeText(shareText);
      alert("Devocional copiado para a área de transferência!");
    }
  };

  const topics = [
    "Ansiedade", "Medo", "Esperança", "Fé", 
    "Descanso", "Gratidão", "Perdão", "Confiança em Deus",
    "Solidão", "Cansaço", "Recomeço", "Amor Próprio"
  ];

  const generateDevotional = async (topic: string | null) => {
    stopAudio(); 
    setUserNote("");
    
    // --- DAILY DEVOTIONAL CACHING LOGIC ---
    // If no topic (Daily Devotional), check storage first
    if (!topic) {
      const todayDate = new Date().toLocaleDateString('pt-BR');
      const cacheKey = `daily_devotional_${todayDate}`;
      const cachedData = localStorage.getItem(cacheKey);

      if (cachedData) {
        try {
          const parsed = JSON.parse(cachedData);
          setContent(parsed);
          setCurrentTopic("Devocional do Dia");
          setView("reading");
          return; // Exit early, do not call API
        } catch (e) {
          console.error("Cache corrupted");
          localStorage.removeItem(cacheKey);
        }
      }
    }

    // If we are here, we need to generate (either it's a Topic OR Daily wasn't cached)
    setIsLoading(true);
    setCurrentTopic(topic || "Devocional do Dia");
    setView("reading");

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      const dateStr = new Date().toLocaleDateString('pt-BR', { 
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' 
      });

      const promptContext = topic 
        ? `Gere um devocional específico sobre o tema: ${topic}.`
        : `Gere o devocional do dia para hoje: ${dateStr}.`;

      const systemInstruction = `
        Você é um escritor espiritual cristão, sensível, acolhedor e profundo.
        O nome do seu livro/app é "Meu terapeuta chamado: DEUS!".
        Seu papel é criar devocionais diários que tragam conforto, esperança, direcionamento espiritual e paz interior.
        
        ESTILO DE ESCRITA:
        - Simples, emocional e acessível.
        - Evite linguagem religiosa pesada ou "evangeliquês" complexo.
        - Tom humano, empático, como um terapeuta da alma conversando com um amigo.
        - Sempre escreva como se estivesse conversando com alguém cansado emocionalmente.
        - Sem moralismo, sem julgamento.

        ESTRUTURA OBRIGATÓRIA (JSON):
        - Retorne APENAS o JSON conforme o schema.
        - A reflexão deve ter entre 3 a 6 parágrafos curtos.
        - O versículo deve vir acompanhado do texto bíblico.
        
        Evite repetir temas recentes. Busque sempre uma nova abordagem emocional.
      `;

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: promptContext,
        config: {
          systemInstruction: systemInstruction,
          responseMimeType: "application/json",
          responseSchema: devotionalSchema,
          temperature: 0.7,
        },
      });

      const text = response.text;
      if (text) {
        const data = JSON.parse(text) as DevotionalContent;
        setContent(data);

        // Save to cache ONLY if it's the Daily Devotional (topic === null)
        if (!topic) {
          const todayDate = new Date().toLocaleDateString('pt-BR');
          const cacheKey = `daily_devotional_${todayDate}`;
          localStorage.setItem(cacheKey, JSON.stringify(data));
        }
      }
    } catch (error) {
      console.error("Erro ao gerar devocional", error);
      setContent({
        title: "Um momento de silêncio",
        verseReference: "Salmos 46:10",
        verseText: "Aquietai-vos, e sabei que eu sou Deus.",
        reflection: "Às vezes, a tecnologia falha, mas a presença de Deus permanece constante. Respire fundo agora. Talvez este erro seja um convite para apenas fechar os olhos e sentir a paz que excede todo o entendimento.\n\nDeus está no silêncio também. Ele está no espaço entre um pensamento e outro. Sinta-se abraçado pelo Criador agora mesmo.",
        application: "Feche os olhos por 1 minuto e apenas respire.",
        prayer: "Senhor, obrigado por estar comigo mesmo quando as coisas não saem como planejado. Amém."
      });
    } finally {
      setIsLoading(false);
    }
  };

  const saveNote = () => {
    if (!content) return;
    const newNote: SavedNote = {
      id: Date.now().toString(),
      date: new Date().toLocaleDateString('pt-BR'),
      topic: currentTopic,
      content: content,
      userNote: userNote,
      timestamp: Date.now()
    };
    const updatedNotes = [newNote, ...savedNotes];
    setSavedNotes(updatedNotes);
    localStorage.setItem("my_devotional_notes", JSON.stringify(updatedNotes));
    alert("Anotação salva no seu diário!");
  };

  const deleteNote = (id: string) => {
    if(confirm("Deseja apagar esta anotação?")) {
      const updated = savedNotes.filter(n => n.id !== id);
      setSavedNotes(updated);
      localStorage.setItem("my_devotional_notes", JSON.stringify(updated));
    }
  }

  // --- Views ---

  if (view === "home") {
    return (
      <div className="min-h-screen relative flex flex-col items-center justify-between overflow-hidden">
        {/* Background Layer */}
        <div className="absolute inset-0 z-0 cover-gradient animate-fade-in" />
        <div className="absolute inset-0 z-0 bg-gradient-to-t from-[#FDFCF5] via-transparent to-transparent h-full" />

        {/* Install App Banner (Only shows once) */}
        {showInstallBanner && (
          <div className="z-50 w-full bg-amber-100/95 backdrop-blur-sm border-b border-amber-200 px-4 py-3 flex items-center justify-between animate-fade-in-up">
            <div className="flex items-center gap-3">
              <div className="bg-amber-500 rounded-lg p-1.5 text-white">
                <Download size={16} />
              </div>
              <div className="text-left">
                <p className="font-[Playfair Display] font-bold text-amber-900 text-sm leading-tight">Instalar App</p>
                <p className="font-[Lora] text-xs text-amber-700">Leitura diária e notificações</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button 
                onClick={handleInstallClick}
                className="bg-amber-600 text-white px-3 py-1.5 rounded-full text-xs font-bold shadow-sm"
              >
                Instalar
              </button>
              <button onClick={dismissInstallBanner} className="text-amber-700 p-1">
                <X size={16} />
              </button>
            </div>
          </div>
        )}

        {/* Top Bar */}
        <div className="z-20 w-full p-6 flex justify-between items-center">
          <button 
            onClick={() => setView("notes-list")}
            className="bg-white/50 backdrop-blur-md p-3 rounded-full text-amber-900 shadow-sm hover:bg-white transition"
            title="Meus Diários"
          >
            <BookOpen size={20} />
          </button>
          
          <button 
            onClick={requestNotificationPermission}
            className={`bg-white/50 backdrop-blur-md p-3 rounded-full shadow-sm hover:bg-white transition ${notificationsEnabled ? 'text-amber-600' : 'text-stone-400'}`}
            title="Ativar Notificações"
          >
            <Bell size={20} fill={notificationsEnabled ? "currentColor" : "none"} />
          </button>
        </div>

        {/* Header Content */}
        <div className="z-10 w-full px-8 flex flex-col items-center text-center animate-fade-in mt-4">
          <div className="flex items-center gap-2 text-amber-700/80 mb-4 tracking-widest uppercase text-xs font-semibold">
            <Feather size={16} />
            <span>Devocional Diário</span>
            <Feather size={16} className="scale-x-[-1]" />
          </div>
          
          <h2 className="font-[Playfair Display] text-3xl text-amber-800 italic mb-1 opacity-90">
            Meu terapeuta
          </h2>
          <h2 className="font-[Playfair Display] text-3xl text-amber-800 italic mb-2 opacity-90">
            chamado:
          </h2>
          <h1 className="font-[Playfair Display] text-5xl md:text-7xl font-bold text-transparent bg-clip-text bg-gradient-to-br from-amber-500 to-amber-700 drop-shadow-sm mb-6 tracking-wide">
            DEUS!
          </h1>
          
          <p className="text-stone-600 font-[Lora] italic max-w-md text-lg leading-relaxed">
            "Um encontro diário de paz para acalmar a sua alma."
          </p>
        </div>

        {/* Actions */}
        <div className="z-10 w-full max-w-md p-6 flex flex-col gap-4 mb-8">
          <button 
            onClick={() => generateDevotional(null)}
            className="w-full bg-gradient-to-r from-amber-600 to-amber-700 text-white font-[Playfair Display] text-xl py-4 rounded-xl shadow-lg shadow-amber-900/10 hover:shadow-xl hover:scale-[1.02] transition-all flex items-center justify-center gap-3"
          >
            <Sun size={24} />
            Ler o Devocional de Hoje
          </button>
          
          <button 
            onClick={() => setView("topics")}
            className="w-full bg-white/60 backdrop-blur-sm border border-amber-200 text-amber-900 font-[Lora] text-lg py-4 rounded-xl shadow-sm hover:bg-white/80 transition-all flex items-center justify-center gap-3"
          >
            <Sparkles size={20} className="text-amber-600" />
            Escolher um tema
          </button>
        </div>
      </div>
    );
  }

  if (view === "topics") {
    return (
      <div className="min-h-screen bg-[#FDFCF5] p-6 pb-20">
        <header className="flex items-center mb-8 pt-4 sticky top-0 bg-[#FDFCF5]/95 backdrop-blur-sm z-10 py-4">
          <button onClick={() => setView("home")} className="p-2 text-stone-500 hover:text-stone-800 transition-colors rounded-full hover:bg-stone-100">
            <ArrowLeft size={28} />
          </button>
          <div className="ml-4">
            <h2 className="font-[Playfair Display] text-2xl text-stone-800">
              O que você sente?
            </h2>
            <p className="text-xs text-stone-500 font-[Lora]">Escolha um tema para o seu coração</p>
          </div>
        </header>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 animate-fade-in-up">
          {topics.map((topic) => (
            <button
              key={topic}
              onClick={() => generateDevotional(topic)}
              className="relative overflow-hidden aspect-[1/1] flex flex-col items-center justify-center p-4 bg-white border border-stone-100 rounded-2xl shadow-sm hover:shadow-lg hover:border-amber-200 transition-all group"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-amber-50/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="mb-4 p-3 bg-stone-50 rounded-full text-stone-400 group-hover:bg-amber-100 group-hover:text-amber-600 transition-all">
                {topicIcons[topic] || <Heart size={24} />}
              </div>
              <span className="font-[Playfair Display] text-lg text-stone-700 group-hover:text-amber-900 font-medium z-10">
                {topic}
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (view === "notes-list") {
    return (
      <div className="min-h-screen bg-[#FAF9F6] p-6">
        <header className="flex items-center mb-8 pt-4 sticky top-0 bg-[#FAF9F6]/95 backdrop-blur-sm z-10 py-4 border-b border-stone-200">
          <button onClick={() => setView("home")} className="p-2 text-stone-500 hover:text-stone-800 transition-colors">
            <ArrowLeft size={28} />
          </button>
          <h2 className="font-[Playfair Display] text-2xl text-stone-800 ml-4">
            Meus Diários
          </h2>
        </header>

        {savedNotes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-stone-400">
            <BookOpen size={48} className="mb-4 opacity-50" />
            <p className="font-[Lora] italic">Seu diário ainda está vazio.</p>
          </div>
        ) : (
          <div className="space-y-6 pb-20">
            {savedNotes.map((note) => (
              <div key={note.id} className="bg-white p-6 rounded-xl shadow-sm border border-stone-100">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <span className="text-xs font-bold text-amber-600 uppercase tracking-wider">{note.date}</span>
                    <h3 className="font-[Playfair Display] text-xl font-bold text-stone-800">{note.content.title}</h3>
                    <span className="text-xs text-stone-500 italic">Tema: {note.topic}</span>
                  </div>
                  <button onClick={() => deleteNote(note.id)} className="text-stone-300 hover:text-red-400 transition">
                    <Trash2 size={18} />
                  </button>
                </div>
                
                <div className="mb-4 p-4 bg-amber-50/50 rounded-lg border-l-4 border-amber-200">
                  <p className="font-[Lora] italic text-sm text-stone-600 line-clamp-3">"{note.content.verseText}"</p>
                </div>

                {note.userNote && (
                  <div className="mt-4 pt-4 border-t border-stone-100">
                    <p className="font-[Lora] text-stone-700 whitespace-pre-wrap">{note.userNote}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // View: Reading (includes Loading State)
  return (
    <div className="min-h-screen bg-[#FAF9F6] text-[#333]">
      {/* Reader Navbar */}
      <nav className="fixed top-0 w-full bg-[#FAF9F6]/95 backdrop-blur-md border-b border-stone-100 z-50 px-4 h-16 flex items-center justify-between transition-all">
        <button onClick={() => { stopAudio(); setView("home"); }} className="p-2 text-stone-500 hover:text-stone-900">
          <ArrowLeft size={24} />
        </button>
        
        <span className="font-[Playfair Display] font-bold text-stone-800 uppercase tracking-wider text-xs md:text-sm truncate max-w-[150px] md:max-w-none">
          {isLoading ? "Escrevendo..." : currentTopic}
        </span>

        <div className="flex gap-1">
          <button 
            onClick={() => setFontSize("small")} 
            className={`p-2 font-[Lora] text-xs ${fontSize === 'small' ? 'text-amber-600 font-bold' : 'text-stone-400'}`}
          >A</button>
          <button 
            onClick={() => setFontSize("medium")} 
            className={`p-2 font-[Lora] text-base ${fontSize === 'medium' ? 'text-amber-600 font-bold' : 'text-stone-400'}`}
          >A</button>
          <button 
            onClick={() => setFontSize("large")} 
            className={`p-2 font-[Lora] text-xl ${fontSize === 'large' ? 'text-amber-600 font-bold' : 'text-stone-400'}`}
          >A</button>
        </div>
      </nav>

      <main className="pt-24 pb-20 px-6 max-w-2xl mx-auto min-h-screen flex flex-col">
        {isLoading ? (
          <div className="flex-1 flex flex-col items-center justify-center animate-pulse gap-6">
            <div className="w-16 h-16 bg-gradient-to-br from-amber-100 to-amber-200 rounded-full flex items-center justify-center">
              <Sun className="text-amber-500 animate-spin-slow" size={32} />
            </div>
            <p className="font-[Playfair Display] text-xl text-stone-400 text-center italic">
              Preparando uma palavra <br/>para o seu coração...
            </p>
          </div>
        ) : content ? (
          <div className={`animate-fade-in-up transition-all duration-500 ${
            fontSize === 'small' ? 'text-base' : fontSize === 'medium' ? 'text-lg' : 'text-xl'
          }`}>
            
            {/* Audio Player */}
            <div className="flex justify-center mb-8">
              <button 
                onClick={handlePlayAudio}
                disabled={isAudioLoading}
                className={`flex items-center gap-2 px-6 py-3 rounded-full transition-all shadow-md ${
                  isPlaying 
                    ? "bg-amber-100 text-amber-800 border border-amber-300" 
                    : "bg-white text-stone-700 border border-stone-200 hover:border-amber-400"
                }`}
              >
                {isAudioLoading ? (
                  <>
                    <Loader size={20} className="animate-spin text-amber-600" />
                    <span className="font-[Lora] text-sm">Gerando áudio...</span>
                  </>
                ) : isPlaying ? (
                  <>
                    <Square size={20} fill="currentColor" className="text-amber-700" />
                    <span className="font-[Lora] text-sm font-semibold">Parar Leitura</span>
                    <div className="flex gap-1 ml-2 items-end h-4">
                      <div className="w-1 bg-amber-500 h-2 animate-pulse"></div>
                      <div className="w-1 bg-amber-500 h-4 animate-pulse delay-75"></div>
                      <div className="w-1 bg-amber-500 h-3 animate-pulse delay-150"></div>
                    </div>
                  </>
                ) : (
                  <>
                    <Volume2 size={20} className="text-amber-600" />
                    <span className="font-[Lora] text-sm">Ouvir Devocional</span>
                  </>
                )}
              </button>
            </div>

            {/* Header */}
            <div className="text-center mb-12 border-b border-stone-200 pb-8">
              <h1 className="font-[Playfair Display] text-3xl md:text-4xl font-bold text-stone-800 leading-tight mb-6">
                {content.title}
              </h1>
              <div className="inline-block relative">
                 <span className="absolute -left-4 -top-4 text-4xl text-amber-200 font-serif">“</span>
                 <p className="font-[Lora] italic text-stone-600 mb-2 px-6">
                   {content.verseText}
                 </p>
                 <span className="absolute -right-4 -bottom-4 text-4xl text-amber-200 font-serif rotate-180">“</span>
              </div>
              <p className="text-xs uppercase tracking-widest text-amber-700 font-bold mt-4">
                {content.verseReference}
              </p>
            </div>

            {/* Reflection Body */}
            <div className="prose prose-stone prose-lg font-[Lora] text-stone-700 leading-loose mb-12">
              {content.reflection.split('\n').map((paragraph, idx) => (
                <p key={idx} className="mb-6 first-letter:text-5xl first-letter:font-[Playfair Display] first-letter:text-stone-800 first-letter:float-left first-letter:mr-2 first-letter:mt-[-10px]">
                  {paragraph}
                </p>
              ))}
            </div>

            {/* Application & Prayer */}
            <div className="bg-[#FDFCF5] p-8 rounded-2xl border border-amber-100 shadow-sm mb-12 relative overflow-hidden">
               <div className="absolute top-0 right-0 w-32 h-32 bg-amber-50 rounded-full -mr-16 -mt-16 blur-2xl opacity-50"></div>
               
               <h3 className="font-[Playfair Display] text-xl font-bold text-amber-800 mb-3 flex items-center gap-2">
                 <Sun size={20} /> Aplicação Prática
               </h3>
               <p className="font-[Lora] text-stone-700 mb-8 italic">
                 {content.application}
               </p>

               <div className="w-full h-px bg-amber-200/50 mb-8"></div>

               <h3 className="font-[Playfair Display] text-xl font-bold text-amber-800 mb-3 flex items-center gap-2">
                 <Heart size={20} /> Oração
               </h3>
               <p className="font-[Lora] text-stone-700">
                 "{content.prayer}"
               </p>
            </div>

            {/* User Notes Section */}
            <div className="bg-white p-6 rounded-2xl border border-stone-200 shadow-sm mb-12">
               <h3 className="font-[Playfair Display] text-lg font-bold text-stone-800 mb-4 flex items-center gap-2">
                 <PenLine size={20} className="text-stone-500" /> 
                 Meu Diário Espiritual
               </h3>
               <textarea
                 value={userNote}
                 onChange={(e) => setUserNote(e.target.value)}
                 placeholder="O que Deus falou ao seu coração hoje? Escreva aqui..."
                 className="w-full h-32 p-4 bg-[#FAF9F6] rounded-lg border border-stone-200 focus:outline-none focus:border-amber-300 font-[Lora] text-stone-600 resize-none mb-4"
               />
               <button 
                 onClick={saveNote}
                 className="flex items-center gap-2 px-6 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition font-[Playfair Display] text-sm"
               >
                 <Save size={16} /> Salvar no Diário
               </button>
            </div>

            {/* Footer */}
            <div className="text-center pb-8 opacity-50">
              <Sparkles className="mx-auto text-amber-400 mb-2" size={24} />
              <p className="font-[Playfair Display] text-sm text-stone-400">
                Meu terapeuta chamado: DEUS!
              </p>
            </div>
          </div>
        ) : null}
      </main>

      {/* Floating Action Button for Share */}
      {!isLoading && content && (
        <button 
          onClick={handleShare}
          className="fixed bottom-6 right-6 bg-stone-800 text-white p-4 rounded-full shadow-lg hover:bg-stone-700 hover:scale-110 active:scale-95 transition-all z-40"
        >
           <Share2 size={24} />
        </button>
      )}
    </div>
  );
};

// Global Animation Styles injected via component to keep single file structure clean
const GlobalStyles = () => (
  <style>{`
    @keyframes fadeInUp {
      from { opacity: 0; transform: translateY(20px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .animate-fade-in-up {
      animation: fadeInUp 0.8s ease-out forwards;
    }
    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    .animate-fade-in {
      animation: fadeIn 1.2s ease-out forwards;
    }
    .animate-spin-slow {
      animation: spin 3s linear infinite;
    }
    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
  `}</style>
);

const root = createRoot(document.getElementById("root")!);
root.render(
  <>
    <GlobalStyles />
    <App />
  </>
);