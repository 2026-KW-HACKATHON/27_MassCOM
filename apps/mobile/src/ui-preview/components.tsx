import { createContext, useContext, type ReactNode } from "react";
import {
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Svg, { Path } from "react-native-svg";
import type { ScreenId } from "./catalog";
import { Art } from "./art";
import { grades, type PreviewState, type Room } from "./model";
import type { GameAction, GameSession } from "./game-model";

export const color = {
  ink: "#123e49",
  muted: "#617888",
  green: "#178773",
  mint: "#def6ed",
  paper: "#faf9f5",
  line: "#e7ece8",
  gold: "#cb780b",
  red: "#bd4650",
};
export type Selection = {
  store: string;
  coin: string;
  friend: string;
  item: string;
  neighbor: string;
  game: number;
  ticket: number;
  mail: string;
  query?: string;
  category?: number;
};
export type PreviewContextValue = {
  state: PreviewState;
  selection: Selection;
  choose: (p: Partial<Selection>) => void;
  update: (f: (s: PreviewState) => PreviewState) => boolean;
  go: (id: ScreenId) => void;
  back: () => void;
  toast: (message: string) => void;
  draft: Room;
  setDraft: (room: Room) => void;
  reset: () => void;
  startGame: (practice: boolean) => void;
  openCatalog: () => void;
  gameSession: GameSession | null;
  gameAction: (a: GameAction) => void;
  quitGame: () => void;
};
export const PreviewContext = createContext<PreviewContextValue | null>(null);
export function usePreview() {
  const ctx = useContext(PreviewContext);
  if (!ctx) throw new Error("Preview provider missing");
  return ctx;
}
const paths: Record<string, string> = {
  home: "M3 10 12 3l9 7v11h-6v-7H9v7H3Z",
  map: "M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0ZM12 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6",
  book: "M12 5C8 2 3 3 2 4v16c4-2 7-1 10 1 3-2 6-3 10-1V4c-4-2-7-1-10 1Zm0 0v16",
  game: "M7 5h10c4 0 5 7 5 12 0 4-4 3-7-1H9c-3 4-7 5-7 1C2 12 3 5 7 5ZM6 9v6m-3-3h6m8-2h.01m3 3h.01",
  bag: "M4 7h16l2 15H2ZM8 9V5a4 4 0 0 1 8 0v4",
  mail: "M2 5h20v16H2Zm0 0 10 9L22 5",
  gear: "m9 2-1 3-3 1-3-1-1 4 3 2v3l-3 2 2 4 3-1 3 1 1 3h4l1-3 3-1 3 1 2-4-3-2v-3l3-2-1-4-3 1-3-1-1-3ZM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8",
  back: "m15 3-9 9 9 9",
  close: "m5 5 14 14M5 19 14 5",
  pencil: "m16 3 5 5-12 12-6 1 1-6Zm-9 10 5 5",
  heart: "M12 21S1 14 1 7c0-6 8-7 11-1 3-6 11-5 11 1 0 7-11 14-11 14Z",
  friends:
    "M8 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 11v-3a7 7 0 0 1 14 0v3M16 4a4 4 0 0 1 0 7m3 3a7 7 0 0 1 4 8",
  scan: "M2 8V2h6m8 0h6v6M2 16v6h6m8 0h6v-6M7 7h10v10H7Z",
  brush: "m14 2 8 5-10 10-5-4ZM8 15c-7-1-3 6-7 7 8 2 11-3 7-7",
  check: "m3 12 6 6L22 4",
  star: "m12 1 3 7 8 1-6 6 2 8-7-4-7 4 2-8-6-6 8-1Z",
  chevron: "m9 4 8 8-8 8",
  shuffle: "M2 5h4l12 14h4M2 19h4L18 5h4m-4-4 4 4-4 4m0 6 4 4-4 4",
  box: "m2 6 10-5 10 5v13l-10 5L2 19Zm0 0 10 6 10-6M12 12v12",
  pause: "M7 3v18M17 3v18",
  gift: "M2 9h20v5H2Zm2 5v9h16v-9M12 9v14M12 9C1 9 2 1 6 2c4 0 6 7 6 7Zm0 0c11 0 10-8 6-7-4 0-6 7-6 7",
  lock: "M5 10h14v13H5ZM8 10V5a4 4 0 0 1 8 0v5M12 15v4",
  search: "M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm6 14 7 7",
};
export function Icon({
  name,
  size = 24,
  tint = color.ink,
  filled = false,
}: {
  name: string;
  size?: number;
  tint?: string;
  filled?: boolean;
}) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={tint}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Path
        d={paths[name] ?? paths.star}
        fill={filled ? tint : "none"}
        fillOpacity={0.22}
      />
    </Svg>
  );
}
export function Txt({
  children,
  muted = false,
  bold = false,
  size = 14,
  center = false,
  tint,
}: {
  children: ReactNode;
  muted?: boolean;
  bold?: boolean;
  size?: number;
  center?: boolean;
  tint?: string;
}) {
  return (
    <Text
      style={{
        color: tint ?? (muted ? color.muted : color.ink),
        fontSize: size,
        lineHeight: size * 1.5,
        fontWeight: bold ? "700" : "400",
        textAlign: center ? "center" : "left",
      }}
    >
      {children}
    </Text>
  );
}
export function Row({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[styles.row, style]}>{children}</View>;
}
export function Card({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[styles.card, style]}>{children}</View>;
}
export function Btn({
  label,
  onPress,
  kind = "primary",
  icon,
  disabled = false,
  small = false,
  style,
}: {
  label: string;
  onPress: () => void;
  kind?: "primary" | "soft" | "outline" | "danger";
  icon?: string;
  disabled?: boolean;
  small?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const white = kind === "primary" || kind === "danger";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor:
            kind === "primary"
              ? color.green
              : kind === "danger"
                ? color.red
                : kind === "soft"
                  ? color.mint
                  : "#fff",
          borderColor: kind === "outline" ? color.line : "transparent",
          minHeight: small ? 40 : 48,
          paddingHorizontal: small ? 12 : 18,
          opacity: disabled ? 0.42 : pressed ? 0.76 : 1,
        },
        style,
      ]}
    >
      {icon ? (
        <Icon
          name={icon}
          size={small ? 19 : 23}
          tint={white ? "white" : color.ink}
        />
      ) : null}
      <Text
        style={{
          fontSize: small ? 13 : 15,
          fontWeight: "700",
          color: white ? "white" : color.ink,
          textAlign: "center",
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
export function Go({
  label,
  to,
  ...props
}: { label: string; to: ScreenId } & Omit<
  Parameters<typeof Btn>[0],
  "label" | "onPress"
>) {
  const { go } = usePreview();
  return <Btn label={label} onPress={() => go(to)} {...props} />;
}
export function Title({
  children,
  back = true,
}: {
  children: ReactNode;
  back?: boolean;
}) {
  const ctx = usePreview();
  return (
    <View style={styles.title}>
      {back ? (
        <Pressable
          onPress={ctx.back}
          accessibilityRole="button"
          accessibilityLabel="뒤로"
          style={styles.back}
        >
          <Icon name="back" />
        </Pressable>
      ) : null}
      <Txt size={23} bold center>
        {children}
      </Txt>
    </View>
  );
}
export function Field({
  label,
  value,
  onChange,
  placeholder,
  multiline = false,
  maxLength = 200,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  maxLength?: number;
}) {
  return (
    <View style={{ gap: 7 }}>
      <Txt bold>{label}</Txt>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={color.muted}
        maxLength={maxLength}
        multiline={multiline}
        style={[
          styles.input,
          multiline && { minHeight: 100, textAlignVertical: "top" },
        ]}
      />
    </View>
  );
}
export function Choices({
  labels,
  value,
  onChange,
}: {
  labels: readonly string[];
  value: number;
  onChange: (i: number) => void;
}) {
  return (
    <Row
      style={{
        padding: 3,
        backgroundColor: "#f0f3f3",
        borderRadius: 14,
        flexWrap: "wrap",
      }}
    >
      {labels.map((label, i) => (
        <Pressable
          key={label}
          accessibilityRole="button"
          accessibilityState={{ selected: value === i }}
          onPress={() => onChange(i)}
          style={{
            flex: 1,
            minWidth: 55,
            minHeight: 42,
            paddingHorizontal: 8,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 11,
            backgroundColor: value === i ? color.mint : "transparent",
          }}
        >
          <Txt bold={value === i} center size={12}>
            {label}
          </Txt>
        </Pressable>
      ))}
    </Row>
  );
}
export function Toggle({
  label,
  value,
  onChange,
  detail,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  detail?: string;
}) {
  return (
    <Row style={{ justifyContent: "space-between", paddingVertical: 12 }}>
      <View style={{ flex: 1, gap: 3 }}>
        <Txt bold>{label}</Txt>
        {detail ? (
          <Txt muted size={12}>
            {detail}
          </Txt>
        ) : null}
      </View>
      <Switch
        accessibilityLabel={label}
        value={value}
        onValueChange={onChange}
        trackColor={{ true: color.green, false: "#cbd4d8" }}
      />
    </Row>
  );
}
export function Notice({
  children,
  danger = false,
}: {
  children: ReactNode;
  danger?: boolean;
}) {
  return (
    <View
      style={{
        backgroundColor: danger ? "#fff0e7" : "#edf4f6",
        padding: 13,
        borderRadius: 12,
      }}
    >
      <Txt tint={danger ? "#ad4c21" : color.muted} size={12}>
        {children}
      </Txt>
    </View>
  );
}
export function Price({ amount }: { amount: number }) {
  return (
    <View style={styles.price}>
      <Text style={styles.pcoin}>P</Text>
      <Txt size={16} bold tint={color.gold}>
        {amount.toLocaleString("ko-KR")} P
      </Txt>
    </View>
  );
}
export function Avatar({
  name = "avatar",
  size = 44,
}: {
  name?: string;
  size?: number;
}) {
  return (
    <Art
      name={name}
      width={size}
      style={{
        height: size,
        borderRadius: size / 2,
        backgroundColor: color.mint,
      }}
    />
  );
}
export function ListLink({
  label,
  to,
  icon = "star",
  detail,
}: {
  label: string;
  to: ScreenId;
  icon?: string;
  detail?: string;
}) {
  const { go } = usePreview();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => go(to)}
      style={styles.listLink}
    >
      <Icon name={icon} />
      <View style={{ flex: 1 }}>
        <Txt bold>{label}</Txt>
        {detail ? (
          <Txt muted size={12}>
            {detail}
          </Txt>
        ) : null}
      </View>
      <Icon name="chevron" size={16} />
    </Pressable>
  );
}
export function CoinRow({
  store,
  family,
  selected,
  onSelect,
  all = false,
}: {
  store: string;
  family?: string;
  selected?: string;
  onSelect?: (grade: string) => void;
  all?: boolean;
}) {
  const { state } = usePreview();
  return (
    <Row style={{ gap: 6, alignItems: "flex-start" }}>
      {grades.map((g, i) => {
        const owned = state.coins.some(
          (c) => c.store === store && (!family || c.family === family) && c.grade === g,
        );
        return (
          <Pressable
            key={g}
            disabled={!onSelect}
            accessibilityRole={onSelect ? "button" : undefined}
            accessibilityLabel={`${g} ${owned ? "보유" : "미보유"}`}
            onPress={() => onSelect?.(g)}
            style={{
              flex: 1,
              gap: 5,
              padding: 5,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: selected === g ? color.green : "transparent",
              backgroundColor: selected === g ? "#effaf5" : "transparent",
            }}
          >
            <Art
              name={["bronze", "silver", "gold", "prism"][i]!}
              style={{ opacity: !owned && !all ? 0.38 : 1 }}
            />
            <Txt center size={11} bold>
              {g}
            </Txt>
            {!all ? (
              <Txt size={10} center muted>
                {owned ? "보유" : "미보유"}
              </Txt>
            ) : null}
          </Pressable>
        );
      })}
    </Row>
  );
}
export const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 10, alignItems: "center" },
  card: {
    backgroundColor: "#fff",
    borderRadius: 18,
    padding: 16,
    gap: 13,
    borderWidth: 1,
    borderColor: color.line,
    shadowColor: "#456057",
    shadowOpacity: 0.045,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  button: {
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    borderWidth: 1,
    paddingVertical: 10,
  },
  title: {
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: 32,
    marginBottom: 3,
  },
  back: {
    position: "absolute",
    left: 0,
    width: 38,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  input: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#d8e2df",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: color.ink,
    minHeight: 47,
  },
  listLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: "#fff",
    minHeight: 62,
  },
  price: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "#fff4df",
    alignSelf: "flex-start",
    paddingVertical: 5,
    paddingHorizontal: 9,
    borderRadius: 18,
  },
  pcoin: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "800",
    width: 21,
    height: 21,
    borderRadius: 11,
    textAlign: "center",
    backgroundColor: "#e6a42f",
    lineHeight: 21,
  },
});
