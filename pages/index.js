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

  // AudioContext e destino
  const audioContextRef = useRef(null);
  const destinationRef = useRef(null);

  // Gravador único que combina user+assistant
  const combinedRecorderRef = useRef(null);

  // URL para download do arquivo final
  const [combinedDownloadUrl, setCombinedDownloadUrl] = useState(null);

  // ========================
  // Iniciar sessão Realtime
  // ========================
  async function startRealtimeSession() {
    try {
      // 1. Buscar token efêmero
      const ephemeralResponse = await fetch("/api/session");
      const ephemeralData = await ephemeralResponse.json();
      const EPHEMERAL_KEY = ephemeralData.client_secret.value;

      // 2. Criar PeerConnection
      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      // 3. Criar (ou reusar) AudioContext e MediaStreamDestination para mix
      const audioCtx = new AudioContext();
      audioContextRef.current = audioCtx;

      const destination = audioCtx.createMediaStreamDestination();
      destinationRef.current = destination;

      // 4. Ao receber trilha remota, vamos mixar no mesmo destination
      //    e reproduzir no <audio> para a gente ouvir localmente.
      const assistantAudioEl = document.createElement("audio");
      assistantAudioEl.autoplay = true;

      pc.ontrack = (event) => {
        // Reproduzir o áudio remoto
        assistantAudioEl.srcObject = event.streams[0];

        // Conectar áudio remoto ao nosso mix
        const assistantSource = audioCtx.createMediaStreamSource(event.streams[0]);
        assistantSource.connect(destination);
      };

      // 5. Obter microfone local
      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = micStream;

      // Conectar trilha local ao PC
      pc.addTrack(micStream.getTracks()[0]);

      // Conectar também no mix
      const userSource = audioCtx.createMediaStreamSource(micStream);
      userSource.connect(destination);

      // 6. DataChannel (opcional, sem exibir logs)
      const dc = pc.createDataChannel("oai-events");
      dataChannelRef.current = dc;

     dc.addEventListener("open", () => {
  // Podemos enviar instruções ou mensagens iniciais (opcional)
  const systemEvent = {
    type: "session.update",
    session: {
      instructions: `
        Você é um entrevistador chamado Cardus, interessado em coletar histórias e narrativas de pessoas que trabalham em uma organização chamada TechFunction.
        Essas narrativas serão usadas para entender o clima e cultura organizacional.
        
        Estimule o usuário a contar histórias e não apenas dar opiniões e fazer julgamentos. 
        O objetivo desse trabalho é fazer um mapeamento dessas narrativas. 
        Tudo será anonimizado, então tranquilize o entrevistado.
        
        Comece perguntando sobre sua rotina ou tipo de trabalho, depois pergunte por histórias. Seu trabalho não é sugerir soluções, apenas coletar histórias. Não interrompa o usuário. 
      `,
      voice: "ash", // Definindo a voz para 'Ash'
      turn_detection: {
        silence_duration_ms: 800, // Colocado corretamente dentro de turn_detection
      },
    },
  };
  dc.send(JSON.stringify(systemEvent));
});



      // 7. Offer/Answer com a API Realtime
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

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

      const answerSdp = await sdpResponse.text();
      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

      // 8. Iniciar gravação de ambos (mix) com um único MediaRecorder
      const combinedRecorder = new MediaRecorder(destination.stream, {
        mimeType: "audio/webm",
      });

      const combinedChunks = [];
      combinedRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          combinedChunks.push(e.data);
        }
      };
      combinedRecorder.onstop = () => {
        const blob = new Blob(combinedChunks, { type: "audio/webm" });
        const localUrl = URL.createObjectURL(blob);
        setCombinedDownloadUrl(localUrl);
      };

      combinedRecorder.start();
      combinedRecorderRef.current = combinedRecorder;

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

    // Parar gravação combinada
    if (
      combinedRecorderRef.current &&
      combinedRecorderRef.current.state === "recording"
    ) {
      combinedRecorderRef.current.stop();
      combinedRecorderRef.current = null;
    }

    // Parar microfone
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((track) => track.stop());
      micStreamRef.current = null;
    }

    // Encerrar AudioContext
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    setIsConnected(false);
    setIsAssistantSpeaking(false);
  }

  return (
    <div style={styles.container}>
      <div style={styles.logoContainer}>
        <TargetTealLogo isSpeaking={isAssistantSpeaking} />
      </div>

      <div style={styles.content}>
        <h1 style={styles.title}>Cardus Realtime Interview</h1>

        <div
          style={{
            marginBottom: "1rem",
            display: "flex",
            gap: "1rem",
            flexWrap: "wrap",
            justifyContent: "center",
          }}
        >
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
        </div>

        <div style={styles.interviewerBox}>
          <h3 style={{ marginBottom: "1rem" }}>Versão Alpha</h3>
          <p>
            Este exemplo grava a entrevista em um arquivo
            de áudio (.webm) que pode ser baixado após a entrevista.
          </p>
        </div>

        {/* Link para o áudio combinado */}
        {combinedDownloadUrl && (
          <div style={styles.downloadContainer}>
            <h3>Gravação da Entrevista:</h3>
            <audio controls src={combinedDownloadUrl} style={{ display: "block", marginTop: "0.5rem" }} />
            <a href={combinedDownloadUrl} download="Recording.webm">
              Baixar Recording.webm
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
