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

  // Gravadores e Blobs de cada stream (usuário e assistente)
  const userRecorderRef = useRef(null);
  const assistantRecorderRef = useRef(null);

  const [userDownloadUrl, setUserDownloadUrl] = useState(null);
  const [assistantDownloadUrl, setAssistantDownloadUrl] = useState(null);

  // Log da conversa (opcional, só para debug textual se ainda quiser ver eventos)
  const [conversationLog, setConversationLog] = useState([]);

  // ========================
  // Iniciar sessão Realtime
  // ========================
  async function startRealtimeSession() {
    try {
      // 1. Buscar token efêmero (client_secret) - ajuste conforme sua API
      const ephemeralResponse = await fetch("/api/session");
      const ephemeralData = await ephemeralResponse.json();
      const EPHEMERAL_KEY = ephemeralData.client_secret.value;

      // 2. Criar PeerConnection
      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      // 3. Criar elemento <audio> para reproduzir áudio remoto (assistente)
      //    Assim que o "ontrack" disparar, vamos gravar esse fluxo.
      const assistantAudioEl = document.createElement("audio");
      assistantAudioEl.autoplay = true;

      pc.ontrack = (event) => {
        // event.streams[0] é o áudio remoto vindo da OpenAI
        assistantAudioEl.srcObject = event.streams[0];

        // Iniciar gravação do áudio remoto do assistente
        const assistantRecorder = new MediaRecorder(event.streams[0], {
          mimeType: "audio/webm",
        });

        const assistantChunks = [];
        assistantRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) {
            assistantChunks.push(e.data);
          }
        };
        assistantRecorder.onstop = () => {
          const blob = new Blob(assistantChunks, { type: "audio/webm" });
          const localUrl = URL.createObjectURL(blob);
          setAssistantDownloadUrl(localUrl);
        };

        assistantRecorder.start();
        assistantRecorderRef.current = assistantRecorder;
      };

      // 4. Obter microfone local
      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = micStream;

      // Adiciona trilha de áudio local ao PC para enviar ao modelo
      pc.addTrack(micStream.getTracks()[0]);

      // 5. Criar DataChannel para troca de eventos (opcional, pois não transcrevemos)
      const dc = pc.createDataChannel("oai-events");
      dataChannelRef.current = dc;

      // 5a. Quando o DC abrir, enviar instruções do sistema (opcional)
      dc.addEventListener("open", () => {
        const systemEvent = {
          type: "session.update",
          session: {
            instructions:
              "Você é um entrevistador chamado Cardus. Apenas responda em voz, não vamos transcrever. Coletamos histórias sobre trabalho na TechFunction.",
          },
        };
        dc.send(JSON.stringify(systemEvent));
      });

      // 5b. Quando o DC abrir, enviar mensagem inicial (opcional)
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

      // 5c. Se quiser ainda ouvir algum evento textual do DataChannel
      dc.addEventListener("message", (event) => {
        const data = JSON.parse(event.data);
        console.log("DataChannel message:", data);
        // Exemplo: se houver algum output textual, logue aqui
        if (data.response?.output) {
          const assistantMessage = data.response.output[0]?.text;
          if (assistantMessage) {
            addToConversationLog("assistant", assistantMessage);
          }
        }

        // Pequeno feedback visual
        setIsAssistantSpeaking(true);
        setTimeout(() => setIsAssistantSpeaking(false), 2000);
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

      // 9. Iniciar gravação local do microfone (usuário)
      const userRecorder = new MediaRecorder(micStream, {
        mimeType: "audio/webm",
      });
      const userChunks = [];
      userRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          userChunks.push(e.data);
        }
      };
      userRecorder.onstop = () => {
        const blob = new Blob(userChunks, { type: "audio/webm" });
        const localUrl = URL.createObjectURL(blob);
        setUserDownloadUrl(localUrl);
      };
      userRecorder.start();
      userRecorderRef.current = userRecorder;

      setIsConnected(true);
    } catch (error) {
      console.error("Erro ao iniciar sessão:", error);
    }
  }

  // ===========================
  // Encerrar sessão Realtime
  // ===========================
  function endInterview() {
    // Fechar PeerConnection
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }

    // Parar gravação do usuário
    if (userRecorderRef.current && userRecorderRef.current.state === "recording") {
      userRecorderRef.current.stop();
      userRecorderRef.current = null;
    }

    // Parar gravação do assistente
    if (
      assistantRecorderRef.current &&
      assistantRecorderRef.current.state === "recording"
    ) {
      assistantRecorderRef.current.stop();
      assistantRecorderRef.current = null;
    }

    // Parar o microfone
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

  // Para baixar o log em texto (se quiser)
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
            Vamos gravar dois fluxos: o seu (usuário) e o do assistente.
            Não vamos transcrever, apenas salvar os áudios localmente.
          </p>
        </div>

        {/* Links para baixar ou reproduzir as gravações */}
        {(userDownloadUrl || assistantDownloadUrl) && (
          <div style={styles.downloadContainer}>
            <h3>Gravações:</h3>
            {userDownloadUrl && (
              <div style={{ margin: "1rem 0" }}>
                <strong>Áudio do Usuário (Local):</strong>
                <audio controls src={userDownloadUrl} style={{ display: "block", marginTop: "0.5rem" }} />
                <a href={userDownloadUrl} download="UserRecording.webm">
                  Baixar UserRecording.webm
                </a>
              </div>
            )}
            {assistantDownloadUrl && (
              <div style={{ margin: "1rem 0" }}>
                <strong>Áudio do Assistente (Remoto):</strong>
                <audio controls src={assistantDownloadUrl} style={{ display: "block", marginTop: "0.5rem" }} />
                <a href={assistantDownloadUrl} download="AssistantRecording.webm">
                  Baixar AssistantRecording.webm
                </a>
              </div>
            )}
          </div>
        )}

        {/* Conversation Log Debug (se quiser ver algum evento textual) */}
        <div
          style={{
            textAlign: "left",
            marginTop: "2rem",
            backgroundColor: "#2B2B2B",
            padding: "1rem",
            borderRadius: "6px",
          }}
        >
          <h2 style={{ marginBottom: "1rem" }}>Conversation Log (opcional)</h2>
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
    textAlign: "left",
  },
};
