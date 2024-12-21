// pages/index.js
import { useState } from "react";
import TargetTealLogo from "./TargetTealLogo"; // Notice the relative import

export default function Home() {
  const [isConnected, setIsConnected] = useState(false);
  const [isAssistantSpeaking, setIsAssistantSpeaking] = useState(false);

  async function startRealtimeSession() {
    try {
      // 1. Fetch ephemeral token from our /api/session endpoint
      const ephemeralResponse = await fetch("/api/session");
      const ephemeralData = await ephemeralResponse.json();
      const EPHEMERAL_KEY = ephemeralData.client_secret.value;

      // 2. Create a PeerConnection
      const pc = new RTCPeerConnection();

      // 3. Create an <audio> element to play remote audio
      const audioEl = document.createElement("audio");
      audioEl.autoplay = true;
      pc.ontrack = (event) => {
        audioEl.srcObject = event.streams[0];
      };

      // 4. Request mic permission and add track
      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      pc.addTrack(micStream.getTracks()[0]);

      // 5. Data channel for sending text events to/from the model
      const dc = pc.createDataChannel("oai-events");
      dc.addEventListener("message", (event) => {
        console.log("Received from model:", event.data);
        // Indicate the assistant is speaking
        setIsAssistantSpeaking(true);
        // Turn off glow after a brief delay
        setTimeout(() => setIsAssistantSpeaking(false), 3000);
      });

      // 6. Create offer & set local description
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // 7. Send the offer SDP to OpenAI
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

      // 8. Set remote description with the answer
      const answerSdp = await sdpResponse.text();
      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

      // 9. (Optional) send an example event to the model
      const exampleEvent = {
        type: "response.create",
        response: {
          modalities: ["text"],
          instructions: "Olá, Cardus aqui! Vamos começar a entrevista.",
        },
      };
      dc.send(JSON.stringify(exampleEvent));

      // Indicate we are connected
      setIsConnected(true);

      console.log("Connected to Realtime API via WebRTC");
    } catch (error) {
      console.error("Error starting session:", error);
    }
  }

  return (
    <div style={styles.container}>
      <div style={styles.logoContainer}>
        <TargetTealLogo isSpeaking={isAssistantSpeaking} />
      </div>
      <div style={styles.content}>
        <h1 style={styles.title}>Realtime Voice Agent Demo (Next.js on Vercel)</h1>
        <button onClick={startRealtimeSession} disabled={isConnected} style={styles.button}>
          {isConnected ? "Conectado!" : "Iniciar Realtime Chat"}
        </button>

        <div style={styles.interviewerBox}>
          <h2 style={{ marginBottom: "1rem" }}>Cardus (Entrevistador)</h2>
          <p>
            Você é um entrevistado que trabalha em uma organização chamada TechFunction. Estou interessado em 
            coletar histórias e narrativas sobre sua experiência. Essas narrativas serão usadas para entender 
            o clima e a cultura organizacional. Tudo será anonimizado, então fique tranquilo! Meu trabalho não 
            é sugerir soluções, apenas coletar histórias.
          </p>
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
    marginBottom: "2rem",
    fontWeight: "bold",
  },
  interviewerBox: {
    textAlign: "left",
    backgroundColor: "#2B2B2B",
    padding: "1rem",
    borderRadius: "6px",
  },
};
