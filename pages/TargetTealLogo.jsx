// pages/TargetTealLogo.jsx

export default function TargetTealLogo({ isSpeaking }) {
  return (
    <div
      style={{
        margin: "0 auto",
        width: 150,
        height: 150,
        position: "relative",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        backgroundColor: "transparent",
        borderRadius: "50%",
        boxShadow: isSpeaking
          ? "0 0 20px 5px rgba(0, 255, 255, 0.7)"
          : "none",
        transition: "box-shadow 0.3s ease-in-out",
      }}
    >
      <img
        src="/logo-icone-tt.svg"
        alt="Target Teal"
        style={{
          width: "100px",
          height: "100px",
          filter: isSpeaking ? "drop-shadow(0 0 10px rgba(0, 255, 255, 0.8))" : "none",
          transition: "filter 0.3s ease-in-out",
        }}
      />
    </div>
  );
}
