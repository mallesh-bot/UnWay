import { useEffect, useMemo, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { useStore } from "../store";
import { t, type TKey } from "../i18n";
import { C } from "../theme";
import type { Rider } from "../types";
import { Avatar, Body, Btn, Sheet, s } from "./ui";

export interface ResolveOption { value: string; label: TKey; note?: string }

/** Ask the crew to give each listed child a status. */
export function ResolveSheet({ visible, title, riders, options, onClose, onSubmit, submitLabel }: {
  visible: boolean; title: string; riders: Rider[]; options: (r: Rider) => ResolveOption[];
  onClose: () => void; onSubmit: (items: { student_id: string; resolution: string; note?: string }[]) => void; submitLabel?: string;
}) {
  const { lang } = useStore();
  const [choice, setChoice] = useState<Record<string, string>>({});
  useEffect(() => { if (visible) setChoice({}); }, [visible]);
  const done = riders.every((r) => choice[r.student_id]);
  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      {riders.map((r) => (
        <View key={r.student_id} style={{ gap: 8, paddingBottom: 12, borderBottomWidth: 1, borderColor: C.line }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Avatar uri={r.photo} name={r.name} size={48} />
            <View style={{ flex: 1 }}><Text style={s.h2}>{r.name}</Text><Body muted>{r.class}</Body></View>
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {options(r).map((o) => (
              <Pressable key={o.value} onPress={() => setChoice({ ...choice, [r.student_id]: o.value })}
                style={{ paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, borderWidth: 2, borderColor: choice[r.student_id] === o.value ? C.ink : C.line, backgroundColor: choice[r.student_id] === o.value ? C.bus : C.white }}>
                <Text style={{ fontWeight: "700", color: C.ink }}>{t(lang, o.label)}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ))}
      <Btn big variant="primary" title={submitLabel ?? t(lang, "save")} disabled={!done} onPress={() => {
        onSubmit(riders.map((r) => {
          const opt = options(r).find((o) => o.value === choice[r.student_id]);
          return { student_id: r.student_id, resolution: choice[r.student_id], note: opt?.note };
        }));
      }} />
    </Sheet>
  );
}

/** Find a child without a card and mark them manually. */
export function ManualSheet({ visible, riders, direction, onClose, onMark }: {
  visible: boolean; riders: Rider[]; direction: "MORNING" | "AFTERNOON"; onClose: () => void;
  onMark: (r: Rider, type: "BOARD" | "DEBOARD") => void;
}) {
  const { lang } = useStore();
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Rider | null>(null);
  useEffect(() => { if (visible) { setQ(""); setPicked(null); } }, [visible]);
  const list = useMemo(() => riders.filter((r) => !["TRANSFERRED"].includes(r.state) && r.name.toLowerCase().includes(q.toLowerCase())).slice(0, 40), [riders, q]);
  return (
    <Sheet visible={visible} onClose={onClose} title={t(lang, "markNoCard")}>
      {picked ? (
        <View style={{ alignItems: "center", gap: 12 }}>
          <Avatar uri={picked.photo} name={picked.name} size={160} />
          <Text style={s.h1}>{picked.name}</Text>
          <Body muted>{picked.class}</Body>
          {picked.state !== "ON_BOARD" && picked.state !== "DROPPED" && picked.state !== "HANDED_OVER" && (
            <Btn big variant="safe" style={{ alignSelf: "stretch" }} title={t(lang, "markBoarded")} onPress={() => onMark(picked, "BOARD")} />
          )}
          {picked.state === "ON_BOARD" && (
            <Btn big variant="primary" style={{ alignSelf: "stretch" }} title={direction === "MORNING" ? t(lang, "reachedSchool") : t(lang, "markDropped")} onPress={() => onMark(picked, "DEBOARD")} />
          )}
          <Btn title={t(lang, "cancel")} style={{ alignSelf: "stretch" }} onPress={() => setPicked(null)} />
        </View>
      ) : (
        <>
          <TextInput style={s.input} placeholder={t(lang, "search")} value={q} onChangeText={setQ} />
          {list.map((r) => (
            <Pressable key={r.student_id} onPress={() => setPicked(r)} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 }}>
              <Avatar uri={r.photo} name={r.name} />
              <View style={{ flex: 1 }}><Text style={{ fontSize: 18, fontWeight: "700", color: C.ink }}>{r.name}</Text><Body muted>{r.class}</Body></View>
            </Pressable>
          ))}
        </>
      )}
    </Sheet>
  );
}

export function ChoiceSheet({ visible, title, sub, choices, onClose }: {
  visible: boolean; title: string; sub?: string; onClose: () => void;
  choices: { label: string; variant?: "primary" | "secondary" | "danger" | "bus" | "safe"; onPress: () => void }[];
}) {
  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      {sub ? <Body>{sub}</Body> : null}
      {choices.map((c) => <Btn key={c.label} big variant={c.variant ?? "secondary"} title={c.label} onPress={c.onPress} />)}
    </Sheet>
  );
}
