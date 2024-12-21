// pages/index.js
import { useState, useRef } from "react";
import TargetTealLogo from "./TargetTealLogo";

export default function Home() {
  const [isConnected, setIsConnected] = useState(false);
  const [isAssistantSpeaking, setIsAssistantSpeaking] = useState(false);

  // Referências e estados para gravador de áudio
  const pcRef = useRef(null);              // Guardar PeerConnection
  const micStreamRef = useRef(null);       // Guardar o stream do microfone
  const recorderRef = useRef(null);        // Guardar o MediaRecorder
  const [downloadUrl, setDownloadUrl] = useState(null);

  async function startRealtimeSession() {
    try {
      // 1. Buscar token efêmero de /api/session
      const ephemeralResponse = await fetch("/api/session");
      const ephemeralData = await ephemeralResponse.json();
      const EPHEMERAL_KEY = ephemeralData.client_secret.value;

      // 2. Criar PeerConnection
      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      // 3. Criar elemento <audio> para tocar o áudio remoto
      const audioEl = document.createElement("audio");
      audioEl.autoplay = true;
      pc.ontrack = (event) => {
        audioEl.srcObject = event.streams[0];
      };

      // 4. Pedir permissão para usar o microfone e adicionar track
      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = micStream;
      pc.addTrack(micStream.getTracks()[0]);

      // 5. DataChannel para enviar/receber mensagens de texto do modelo
      const dc = pc.createDataChannel("oai-events");
      dc.addEventListener("message", (event) => {
        console.log("Recebido do modelo:", event.data);
        setIsAssistantSpeaking(true);
        setTimeout(() => setIsAssistantSpeaking(false), 3000);
      });

      // 6. Criar offer e setar descrição local
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // 7. Enviar offer SDP à API Realtime da OpenAI
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

      // 8. Definir descrição remota com a answer
      const answerSdp = await sdpResponse.text();
      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

      // 9. (Opcional) enviar um exemplo de evento para o modelo
      const exampleEvent = {
        type: "response.create",
        response: {
          modalities: ["text"],
          instructions: "Olá, Cardus aqui! Vamos começar a entrevista.",
        },
      };
      dc.send(JSON.stringify(exampleEvent));

      // === Gravação do áudio (MediaRecorder) ===
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
        // Ao parar a gravação, criar o blob e disponibilizar um link para download
        const blob = new Blob(chunks, { type: "audio/webm" });
        const url = URL.createObjectURL(blob);
        setDownloadUrl(url);
      };

      mediaRecorder.start();
      recorderRef.current = mediaRecorder;

      // Marcar conexão como estabelecida
      setIsConnected(true);

      console.log("Conectado à Realtime API via WebRTC");
    } catch (error) {
      console.error("Erro ao iniciar sessão:", error);
    }
  }

  function endInterview() {
    // 1. Fechar a PeerConnection
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }

    // 2. Parar gravação de áudio
    if (recorderRef.current && recorderRef.current.state === "recording") {
      recorderRef.current.stop(); // dispara o onstop => gera o link p/ download
      recorderRef.current = null;
    }

    // 3. Parar as tracks do microfone
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((track) => track.stop());
      micStreamRef.current = null;
    }

    // 4. Atualizar estado de conexão
    setIsConnected(false);
    setIsAssistantSpeaking(false);
    console.log("Entrevista encerrada.");
  }

  return (
    <div style={styles.container}>
      <div style={styles.logoContainer}>
        <TargetTealLogo isSpeaking={isAssistantSpeaking} />
      </div>
      <div style={styles.content}>
        <h1 style={styles.title}>Realtime Voice Agent Demo (Next.js on Vercel)</h1>

        <div style={{ marginBottom: "1rem" }}>
          <button
            onClick={startRealtimeSession}
            disabled={isConnected}
            style={styles.button}
          >
            {isConnected ? "Conectado!" : "Iniciar Realtime Chat"}
          </button>

          {" "}

          <button
            onClick={endInterview}
            disabled={!isConnected}
            style={{ ...styles.button, backgroundColor: "#FF4444" }}
          >
            Encerrar Entrevista
          </button>
        </div>

        <div style={styles.interviewerBox}>
          <h2 style={{ marginBottom: "1rem" }}>Cardus (Entrevistador)</h2>
          <p>
            Meu nome é Cardus, sou um entrevistador contratado pela Target Teal. 
            Estou interessado em coletar histórias e narrativas sobre sua experiência. 
            Essas narrativas serão usadas para entender o clima e a cultura organizacional. 
            Tudo será anonimizado, então fique tranquilo! Meu trabalho não é sugerir soluções, 
            apenas coletar histórias.
          </p>
        </div>

        {/* Caso exista um link de download disponível, exibir */}
        {downloadUrl && (
          <div style={styles.downloadContainer}>
            <p>Gravação da Entrevista:</p>
            <audio controls src={downloadUrl} />
            <br />
            <a href={downloadUrl} download="entrevista.webm">
              Baixar Arquivo
            </a>
          </div>
        )}
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
    marginRight: "1rem",
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
