import { useState, useRef } from "react";
import TargetTealLogo from "./TargetTealLogo";

export default function Home() {
  // Estados de controle
  const [isConnected, setIsConnected] = useState(false);
  const [isAssistantSpeaking, setIsAssistantSpeaking] = useState(false);

  // Referências para WebRTC
  const pcRef = useRef(null);         // PeerConnection
  const micStreamRef = useRef(null);  // Stream do microfone
  const dataChannelRef = useRef(null);

  // Referências e estados para gravação
  const recorderRef = useRef(null);
  const [downloadUrl, setDownloadUrl] = useState(null);
  const [conversationLog, setConversationLog] = useState([]);

  // ========================
  // Iniciar sessão Realtime
  // ========================
  async function startRealtimeSession() {
    try {
      // 1. Buscar token efêmero (client_secret)
      const ephemeralResponse = await fetch("/api/session");
      const ephemeralData = await ephemeralResponse.json();
      const EPHEMERAL_KEY = ephemeralData.client_secret.value;

      // 2. Criar PeerConnection
      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      // 3. Criar elemento <audio> para reproduzir áudio remoto
      const audioEl = document.createElement("audio");
      audioEl.autoplay = true;
      pc.ontrack = (event) => {
        audioEl.srcObject = event.streams[0];
      };

      // 4. Obter microfone local
      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = micStream;
      pc.addTrack(micStream.getTracks()[0]);

      // 5. Criar DataChannel
      const dc = pc.createDataChannel("oai-events");
      dataChannelRef.current = dc;

      // 5a. Quando o DC abrir
      dc.addEventListener("open", () => {
        const systemEvent = {
          type: "session.update",
          session: {
            instructions: "Você é um entrevistador chamado Cardus, interessado em coletar histórias e narrativas de pessoas que trabalham na TechFunction. Estimule o usuário a contar histórias, sem julgamentos. Tudo será anonimizado. Não ofereça soluções, apenas colete as histórias.",
          },
        };
        dc.send(JSON.stringify(systemEvent));
      });

      // 5b. Enviar mensagem inicial
      dc.addEventListener("open", () => {
        const welcomeEvent = {
          type: "conversation.item.create",
          item: {
            type: "message",
            role: "assistant",
            content: [
              {
                type: "input_text",
                text: "Olá! Podemos começar a entrevista?",
              },
            ],
          },
        };
        dc.send(JSON.stringify(welcomeEvent));
        addToConversationLog("assistant", "Olá! Podemos começar a entrevista?");
      });

      // 5c. Ao receber mensagens do modelo
      dc.addEventListener("message", (event) => {
        const data = JSON.parse(event.data);
        console.log("DataChannel message:", data); // <-- Add this to debug structure

        // Registro de mensagens do assistente
        if (data.type === "response.done" && data.response?.output) {
          const assistantMessage = data.response.output[0]?.text;
          if (assistantMessage) {
            addToConversationLog("assistant", assistantMessage);
          }
        }

        // Registro de mensagens do usuário
        if (data.type === "conversation.item.created" && data.item?.role === "user") {
          const userMessage = data.item.content[0]?.text;
          if (userMessage) {
            addToConversationLog("user", userMessage);
          }
        }

        setIsAssistantSpeaking(true);
        setTimeout(() => setIsAssistantSpeaking(false), 3000);
      });

      // 6. Criar offer e setar descrição local
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // 7. Enviar offer para a OpenAI Realtime
      const baseUrl = "https://api.openai.com/v1/realtime";
      const model = "gpt-4o-realtime-preview-2024-12-17";

      const sdpResponse = await fetch(`${baseUrl}?model=${model}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${EPHEMERAL_KEY}`,
          "Content-Type": "application/sdp",
        },
        body: offer.sdp,
      });

      // 8. Receber answer e setar descrição remota
      const answerSdp = await sdpResponse.text();
      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

      // 9. Iniciar gravação local do microfone
      const mediaRecorder = new MediaRecorder(micStream, {
        mimeType: "audio/webm",
      });

      const chunks = [];
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunks.push(e.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunks, { type: "audio/webm" });
        const localUrl = URL.createObjectURL(blob);
        setDownloadUrl(localUrl);
      };

      mediaRecorder.start();
      recorderRef.current = mediaRecorder;

      setIsConnected(true);
    } catch (error) {
      console.error("Erro ao iniciar sessão:", error);
    }
  }

  // ===========================
  // Encerrar sessão Realtime
  // ===========================
  function endInterview() {
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }

    if (recorderRef.current && recorderRef.current.state === "recording") {
      recorderRef.current.stop();
      recorderRef.current = null;
    }

    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((track) => track.stop());
      micStreamRef.current = null;
    }

    setIsConnected(false);
    setIsAssistantSpeaking(false);
  }

  // ===========================
  // Gerar log da conversa
  // ===========================
  function addToConversationLog(sender, message) {
    setConversationLog((prev) => [...prev, { sender, message }]);
  }

  function downloadConversationLog() {
    const logContent = conversationLog
      .map((entry) => `${entry.sender}: ${entry.message}`)
      .join("\n");
    const blob = new Blob([logContent], { type: "text/plain" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "conversation_log.txt";
    link.click();
  }

  return (
    <div style={styles.container}>
      <div style={styles.logoContainer}>
        <TargetTealLogo isSpeaking={isAssistantSpeaking} />
      </div>

      <div style={styles.content}>
        <h1 style={styles.title}>Cardus Realtime Interview</h1>

        <div style={{ marginBottom: "1rem", display: "flex", gap: "1rem", flexWrap: "wrap" }}>
          <button
            onClick={startRealtimeSession}
            disabled={isConnected}
            style={styles.button}
          >
            {isConnected ? "Conectado!" : "Iniciar Realtime Chat"}
          </button>

          <button
            onClick={endInterview}
            disabled={!isConnected}
            style={{
              ...styles.button,
              backgroundColor: isConnected ? "#FF4444" : "#666",
            }}
          >
            Encerrar Entrevista
          </button>

          <button
            onClick={downloadConversationLog}
            style={styles.button}
            disabled={conversationLog.length === 0}
          >
            Baixar Log da Conversa
          </button>
        </div>

        <div style={styles.interviewerBox}>
          <h2 style={{ marginBottom: "1rem" }}>Cardus (Entrevistador)</h2>
          <p>
            Você é um entrevistado que trabalha em uma organização chamada TechFunction.
            Estou interessado em coletar histórias e narrativas sobre sua experiência.
            Essas narrativas serão usadas para entender o clima e a cultura organizacional.
            Tudo será anonimizado, então fique tranquilo! Meu trabalho não é sugerir soluções,
            apenas coletar histórias.
          </p>
        </div>

        {/* Link local para o áudio gravado */}
        {downloadUrl && (
          <div style={styles.downloadContainer}>
            <p>Áudio Gravado (Local):</p>
            <audio controls src={downloadUrl} />
            <br />
            <a href={downloadUrl} download="entrevista.webm">
              Baixar Arquivo WEBM
            </a>
          </div>
        )}

        {/* Conversation Log Debug */}
        <div style={{ textAlign: 'left', marginTop: '2rem', backgroundColor: '#2B2B2B', padding: '1rem', borderRadius: '6px' }}>
          <h2 style={{ marginBottom: '1rem' }}>Conversation Log</h2>
          {conversationLog.map((entry, idx) => (
            <p key={idx}>
              <strong>{entry.sender}:</strong> {entry.message}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}

const styles = {
  container: {
    backgroundColor: "#121212",
    color: "#FFFFFF",
    minHeight: "100vh",
    padding: "2rem",
    fontFamily: "sans-serif",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
  },
  logoContainer: {
    marginBottom: "2rem",
  },
  content: {
    maxWidth: "600px",
    width: "100%",
    textAlign: "center",
    backgroundColor: "#1E1E1E",
    padding: "2rem",
    borderRadius: "8px",
    boxShadow: "0 0 10px rgba(0, 255, 255, 0.3)",
  },
  title: {
    marginBottom: "1rem",
  },
  button: {
    backgroundColor: "#00FFFF",
    color: "#000",
    border: "none",
    padding: "0.8rem 1.2rem",
    borderRadius: "4px",
    cursor: "pointer",
    fontWeight: "bold",
    minWidth: "200px",
  },
  interviewerBox: {
    textAlign: "left",
    backgroundColor: "#2B2B2B",
    padding: "1rem",
    borderRadius: "6px",
    marginTop: "1rem",
  },
  downloadContainer: {
    marginTop: "2rem",
  },
};
