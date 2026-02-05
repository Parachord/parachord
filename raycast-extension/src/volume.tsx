import { Action, ActionPanel, List, showHUD } from "@raycast/api";
import { openParachord } from "./utils";

const VOLUME_LEVELS = [
  { title: "Mute", value: 0, icon: "🔇" },
  { title: "10%", value: 10, icon: "🔈" },
  { title: "20%", value: 20, icon: "🔈" },
  { title: "30%", value: 30, icon: "🔈" },
  { title: "40%", value: 40, icon: "🔉" },
  { title: "50%", value: 50, icon: "🔉" },
  { title: "60%", value: 60, icon: "🔉" },
  { title: "70%", value: 70, icon: "🔊" },
  { title: "80%", value: 80, icon: "🔊" },
  { title: "90%", value: 90, icon: "🔊" },
  { title: "100%", value: 100, icon: "🔊" },
];

export default function Command() {
  const handleSelect = async (value: number) => {
    await openParachord("volume", [value.toString()], {});
    await showHUD(`Volume set to ${value}%`);
  };

  return (
    <List>
      {VOLUME_LEVELS.map((level) => (
        <List.Item
          key={level.value}
          title={level.title}
          icon={level.icon}
          actions={
            <ActionPanel>
              <Action title="Set Volume" onAction={() => handleSelect(level.value)} />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}
