import { JoinForm } from "@/components/JoinForm";

export default function JoinPage() {
  return (
    <>
      <h1 className="serif">Join a discussion</h1>
      <p className="muted">Use the link from your host, or the meeting ID plus access code. You will check your camera and microphone before entering.</p>
      <JoinForm />
    </>
  );
}
