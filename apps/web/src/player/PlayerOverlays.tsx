import AudiobookSwitchModal from "../components/AudiobookSwitchModal";
import { usePlayer } from "./PlayerContext";

export default function PlayerOverlays() {
  const player = usePlayer();
  if (!player.audiobookSwitchPrompt) return null;
  return (
    <AudiobookSwitchModal
      prompt={player.audiobookSwitchPrompt}
      onContinue={player.continueCurrentAudiobook}
      onSwitch={() => void player.switchToPendingAudiobook()}
    />
  );
}
