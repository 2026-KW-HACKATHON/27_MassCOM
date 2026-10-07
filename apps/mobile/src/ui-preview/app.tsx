import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AccountScreens } from "./account-screens";
import { activeTab, screenCatalog, tabs, type ScreenId } from "./catalog";
import { CommerceScreens } from "./commerce-screens";
import {
  Avatar,
  Btn,
  Icon,
  PreviewContext,
  Txt,
  color,
  type Selection,
} from "./components";
import { gameStep, newGame, type GameSession } from "./game-model";
import {
  finishGame,
  initialPreviewState,
  restorePreviewState,
  STORAGE_KEY,
  type PreviewState,
  type Room,
} from "./model";
import { gameScreenRoutes, leaveGuard, roomEditRoutes } from "./navigation";
import { gameRoutes, PlayScreens } from "./play-screens";
import { SocialScreens } from "./social-screens";

export const UI_PREVIEW_ENABLED = true;
const defaults: Selection = {
  store: "cafe",
  coin: "c2",
  friend: "하루",
  item: "sofa",
  neighbor: "mocha",
  game: 0,
  ticket: 0,
  mail: "gift-sora",
};
export function UiPreviewApp() {
  const insets = useSafeAreaInsets();
  const [state, setState] = useState(initialPreviewState);
  const stateRef = useRef(state);
  const [loaded, setLoaded] = useState(false);
  const [route, setRoute] = useState<ScreenId>("00-0");
  const routeRef = useRef(route);
  const history = useRef<ScreenId[]>([]);
  const [selection, setSelection] = useState(defaults),
    selectionRef = useRef(selection);
  const [draft, setDraftState] = useState(state.room);
  const draftRef = useRef(draft);
  const setDraft = useCallback((room: Room) => {
    draftRef.current = room;
    setDraftState(room);
  }, []);
  const [message, setMessage] = useState("");
  const [showCatalog, setShowCatalog] = useState(false);
  const [search, setSearch] = useState("");
  const [session, setSession] = useState<GameSession | null>(null);
  const sessionRef = useRef(session);
  useEffect(() => { sessionRef.current = session; }, [session]);
  const [pendingLeave, setPendingLeave] = useState<{
    kind: "room" | "game"; id: ScreenId; back: boolean; replacesGame: boolean;
  } | null>(null);
  const saveQueue = useRef(Promise.resolve());
  const [saveError, setSaveError] = useState(false);
  const [saving, setSaving] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [retry, setRetry] = useState(0);
  const toast = useCallback((s: string) => setMessage(s), []);
  useEffect(() => {
    let mounted = true;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (!mounted) return;
        const next = restorePreviewState(raw);
        stateRef.current = next;
        setState(next);
        setDraft(next.room);
        setLoaded(true);
      })
      .catch(() => {
        if (mounted) {
          setLoadError(true);
        }
      });
    return () => {
      mounted = false;
    };
  }, [retry, setDraft]);
  useEffect(() => {
    if (!loaded) return;
    const json = JSON.stringify(state);
    let current = true;
    saveQueue.current = saveQueue.current
      .catch(() => {})
      .then(() => AsyncStorage.setItem(STORAGE_KEY, json))
      .then(() => { if (current) { setSaveError(false); setSaving(false); } })
      .catch(() => { if (current) { setSaveError(true); setSaving(false); } });
    return () => { current = false; };
  }, [state, loaded]);
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(""), 3200);
    return () => clearTimeout(timer);
  }, [message]);
  const update = useCallback(
    (fn: (s: PreviewState) => PreviewState) => {
      try {
        const next = fn(stateRef.current);
        if (next === stateRef.current) return true;
        stateRef.current = next;
        setSaving(true);
        setState(next);
        return true;
      } catch (e) {
        toast(e instanceof Error ? e.message : "변경을 저장하지 못했어요.");
        return false;
      }
    },
    [toast],
  );
  const choose = useCallback((patch: Partial<Selection>) => {
    selectionRef.current = { ...selectionRef.current, ...patch };
    setSelection(selectionRef.current);
  }, []);
  const navigate = useCallback((id: ScreenId) => {
    setSession((g) => (g ? { ...g, paused: !gameRoutes.includes(id) } : g));
    if (!roomEditRoutes.includes(id))
      setDraft({
        ...stateRef.current.room,
        displayed: [...stateRef.current.room.displayed],
      });
    routeRef.current = id;
    setRoute(id);
    setShowCatalog(false);
  }, [setDraft]);
  const finishNavigation = useCallback((id: ScreenId, isBack: boolean, replacesGame = false) => {
    if (replacesGame) {
      choose({ game: gameRoutes.indexOf(id) });
      sessionRef.current = null;
      setSession(null);
    }
    if (isBack) history.current.pop();
    else if (routeRef.current !== id) history.current.push(routeRef.current);
    navigate(id);
  }, [navigate, choose]);
  const requestNavigation = useCallback(
    (id: ScreenId, isBack = false, replacesGame = false) => {
      if (!screenCatalog.some((s) => s.id === id)) return;
      const kind = leaveGuard(routeRef.current, id, draftRef.current, stateRef.current.room, sessionRef.current, replacesGame);
      if (kind) {
        setShowCatalog(false);
        setSession((g) => g ? { ...g, paused: true } : g);
        setPendingLeave({ kind, id, back: isBack, replacesGame });
        return;
      }
      finishNavigation(id, isBack, replacesGame);
    },
    [finishNavigation],
  );
  const go = useCallback((id: ScreenId) => requestNavigation(id), [requestNavigation]);
  const openCatalog = useCallback(() => {
    setSession((g) => g ? { ...g, paused: true } : g);
    setShowCatalog(true);
  }, []);
  const closeCatalog = useCallback(() => {
    setShowCatalog(false);
    if (gameScreenRoutes.includes(routeRef.current))
      setSession((g) => g ? { ...g, paused: false } : g);
  }, []);
  const back = useCallback(() => {
    if (showCatalog) {
      closeCatalog();
      return;
    }
    const id = history.current.at(-1) ?? "00-0";
    requestNavigation(id, true);
  }, [showCatalog, requestNavigation, closeCatalog]);
  const cancelLeave = useCallback(() => {
    setPendingLeave(null);
    if (gameScreenRoutes.includes(routeRef.current))
      setSession((g) => g ? { ...g, paused: false } : g);
  }, []);
  const confirmLeave = useCallback((saveRoom: boolean) => {
    if (!pendingLeave) return;
    if (pendingLeave.kind === "room" && saveRoom)
      update((s) => ({ ...s, room: { ...draftRef.current } }));
    if (pendingLeave.kind === "game") {
      sessionRef.current = null;
      setSession(null);
    }
    finishNavigation(pendingLeave.id, pendingLeave.back, pendingLeave.replacesGame);
    setPendingLeave(null);
  }, [pendingLeave, finishNavigation, update]);
  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        if (route === "00-0" && !showCatalog) return false;
        back();
        return true;
      },
    );
    return () => subscription.remove();
  }, [route, showCatalog, back]);
  const startGame = useCallback(
    (practice: boolean) => {
      const next = newGame(selectionRef.current.game, practice);
      sessionRef.current = next;
      setSession(next);
      go(gameRoutes[next.kind]!);
    },
    [go],
  );
  useEffect(() => {
    if (!session?.id) return;
    const timer = setInterval(
      () => setSession((g) => (g ? gameStep(g, { type: "tick" }) : g)),
      100,
    );
    return () => clearInterval(timer);
  }, [session?.id]);
  useEffect(() => {
    if (!session?.done) return;
    const completion = setTimeout(() => {
      update((s) =>
        finishGame(
          s,
          session.kind,
          session.score,
          session.id,
          session.practice,
        ),
      );
      go("17-1");
    }, 0);
    return () => clearTimeout(completion);
  }, [
    session?.done,
    session?.id,
    session?.kind,
    session?.practice,
    session?.score,
    update,
    go,
  ]);
  const reset = useCallback(() => {
    const fresh = initialPreviewState();
    stateRef.current = fresh;
    setSaving(true);
    setState(fresh);
    setLoadError(false);
    setLoaded(true);
    setDraft(fresh.room);
    choose(defaults);
    setSession(null);
    sessionRef.current = null;
    setPendingLeave(null);
    history.current = [];
    routeRef.current = "00-0";
    setRoute("00-0");
    toast("테스트 데이터를 초기화했어요.");
  }, [choose, toast, setDraft]);
  const board = Number(route.split("-")[0]),
    panel = Number(route.split("-")[1]);
  const active = activeTab(route);
  const barColor =
    state.navTheme === "wood"
      ? "#dfb586"
      : state.navTheme === "night"
        ? "#26334c"
        : "#fff";
  const ink = state.navTheme === "night" ? "#e1e8f2" : color.muted;
  if (loadError && !loaded) return (
    <View style={appStyles.loading}>
      <Txt>이 기기의 테스트 기록을 읽지 못했어요.</Txt>
      <Txt muted>기존 기록은 덮어쓰지 않았어요.</Txt>
      <Btn label="불러오기 다시 시도" onPress={() => { setLoadError(false); setRetry((n) => n + 1); }} />
      <Btn label="기존 테스트 기록을 지우고 초기화" onPress={reset} />
    </View>
  );
  if (!loaded)
    return (
      <View style={appStyles.loading}>
        <ActivityIndicator color={color.green} />
        <Txt>테스트 앱을 준비하고 있어요.</Txt>
      </View>
    );
  return (
    <PreviewContext.Provider
      value={{
        state,
        selection,
        choose,
        update,
        go,
        back,
        toast,
        draft,
        setDraft,
        reset,
        startGame,
        openCatalog,
        gameSession: session,
        gameAction: (a) => setSession((g) => (g ? gameStep(g, a) : g)),
        quitGame: () => { sessionRef.current = null; setSession(null); },
      }}
    >
      <View style={appStyles.backdrop}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={[appStyles.app, { paddingTop: insets.top }]}
        >
          <View style={appStyles.testBar}>
            <Pressable
              accessibilityRole="button"
              onPress={openCatalog}
            >
              <Text style={appStyles.testText}>
                로컬 테스트 · 67개 화면 보기
              </Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={saveError ? "로컬 저장 다시 시도" : "로컬 저장 상태"}
              disabled={!saveError} onPress={() => update((s) => ({ ...s }))}>
              <Text style={appStyles.testText}>
                {saving ? "저장 중" : saveError ? "저장 실패 · 재시도" : "기기에 저장됨"}
              </Text>
            </Pressable>
          </View>
          {board === 21 ? (
            <View style={appStyles.header}>
              <Icon name="home" size={26} />
              <Txt bold size={23}>
                MassCOM
              </Txt>
            </View>
          ) : (
            <View style={appStyles.header}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="내 프로필"
                onPress={() => go("18-0")}
              >
                <Avatar size={39} />
              </Pressable>
              <Pressable
                style={appStyles.profile}
                onPress={() => go("18-1")}
                accessibilityRole="button"
                accessibilityLabel="한 줄 소개 편집"
              >
                <Text style={appStyles.nickname}>{state.nickname}</Text>
                <Text numberOfLines={1} style={appStyles.intro}>
                  {state.intro} ✎
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="마일리지 내역"
                onPress={() => go("14-1")}
                style={appStyles.points}
              >
                <Text style={appStyles.pointsText}>
                  Ⓟ {state.points.toLocaleString()}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="우편함"
                onPress={() => go("19-0")}
                style={appStyles.iconButton}
              >
                <Icon name="mail" size={24} />
                {state.mail.some((m) => !m.read) ? (
                  <View style={appStyles.unread} />
                ) : null}
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="설정"
                onPress={() => go("20-0")}
                style={appStyles.iconButton}
              >
                <Icon name="gear" size={24} />
              </Pressable>
            </View>
          )}
          <ScrollView
            key={route}
            style={{ flex: 1 }}
            contentContainerStyle={[
              appStyles.content,
              board === 0 && appStyles.homeContent,
            ]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {board <= 6 ? (
              <SocialScreens board={board} panel={panel} />
            ) : board <= 14 ? (
              <CommerceScreens board={board} panel={panel} />
            ) : board <= 17 ? (
              <PlayScreens board={board} panel={panel} />
            ) : (
              <AccountScreens board={board} panel={panel} />
            )}
          </ScrollView>
          <View
            accessibilityRole="tablist"
            style={[
              appStyles.nav,
              {
                backgroundColor: barColor,
                paddingBottom: Math.max(insets.bottom, 9),
              },
            ]}
          >
            {tabs.map((tab, i) => (
              <Pressable
                key={tab.label}
                accessibilityRole="tab"
                accessibilityLabel={tab.label}
                accessibilityState={{ selected: i === active }}
                onPress={() => go(tab.screen)}
                style={[
                  appStyles.navItem,
                  {
                    backgroundColor:
                      i === active
                        ? state.navTheme === "night"
                          ? "#43516c"
                          : color.mint
                        : "transparent",
                  },
                ]}
              >
                <Icon
                  name={tab.icon}
                  size={25}
                  filled={state.iconStyle === "filled"}
                  tint={i === active ? state.accent : ink}
                />
                <Text
                  style={{
                    color: i === active ? state.accent : ink,
                    fontSize: 11,
                    fontWeight: i === active ? "700" : "500",
                  }}
                >
                  {tab.label}
                </Text>
              </Pressable>
            ))}
          </View>
          {message ? (
            <View
              accessibilityLiveRegion="polite"
              pointerEvents="none"
              style={appStyles.toast}
            >
              <Text
                style={{ color: "white", textAlign: "center", fontSize: 13 }}
              >
                {message}
              </Text>
            </View>
          ) : null}
        </KeyboardAvoidingView>
      </View>
      <Modal transparent visible={!!pendingLeave} animationType={state.settings.reducedMotion ? "none" : "fade"} onRequestClose={cancelLeave}>
        <View style={appStyles.modal}>
          <View style={appStyles.catalog} accessibilityViewIsModal>
            <Txt bold size={21}>{pendingLeave?.kind === "room" ? "꾸미기를 저장할까요?" : "놀이를 나갈까요?"}</Txt>
            <Txt>{pendingLeave?.kind === "room" ? "저장하지 않은 배치가 있어요." : "나가면 이번 진행 기록은 저장되지 않고 보상도 받지 않아요."}</Txt>
            {pendingLeave?.kind === "room" ? <Btn label="저장하고 이동" onPress={() => confirmLeave(true)} /> : null}
            <Btn label={pendingLeave?.kind === "room" ? "버리고 이동" : "놀이 나가기"} kind="outline" onPress={() => confirmLeave(false)} />
            <Btn label={pendingLeave?.kind === "room" ? "계속 편집" : "계속하기"} kind="soft" onPress={cancelLeave} />
          </View>
        </View>
      </Modal>
      <Modal
        transparent
        animationType={state.settings.reducedMotion ? "none" : "fade"}
        visible={showCatalog}
        onRequestClose={closeCatalog}
      >
        <View style={appStyles.modal}>
          <View
            style={[
              appStyles.catalog,
              { paddingTop: Math.max(insets.top, 16) },
            ]}
          >
            <View style={appStyles.catalogTitle}>
              <Txt size={20} bold>
                전체 테스트 화면
              </Txt>
              <Btn
                label="닫기"
                kind="outline"
                small
                onPress={closeCatalog}
              />
            </View>
            <TextInput
              accessibilityLabel="화면 검색"
              value={search}
              onChangeText={setSearch}
              placeholder="친구, 리롤, 설정..."
              style={appStyles.search}
            />
            <ScrollView keyboardShouldPersistTaps="handled">
              {screenCatalog
                .filter((s) => `${s.title} ${s.group}`.includes(search))
                .map((s, i) => (
                  <Pressable
                    key={s.id}
                    accessibilityRole="button"
                    onPress={() => {
                      requestNavigation(s.id, false, gameRoutes.includes(s.id));
                    }}
                    style={appStyles.catalogItem}
                  >
                    <Txt size={13} bold>
                      {String(i + 1).padStart(2, "0")} · {s.title}
                    </Txt>
                    <Txt size={10} muted>
                      {s.id} · {s.group}
                    </Txt>
                  </Pressable>
                ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </PreviewContext.Provider>
  );
}
const appStyles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "#e9eee9", alignItems: "center" },
  app: { flex: 1, width: "100%", maxWidth: 480, backgroundColor: color.paper },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  testBar: {
    height: 28,
    paddingHorizontal: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#edf3ed",
  },
  testText: { fontSize: 10, color: "#6b8077" },
  header: {
    minHeight: 78,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  profile: { flex: 1, minWidth: 40, gap: 3 },
  nickname: { fontSize: 15, fontWeight: "800", color: color.ink },
  intro: { fontSize: 10, color: color.muted },
  points: {
    borderRadius: 20,
    paddingVertical: 7,
    paddingHorizontal: 8,
    backgroundColor: "#fff0d9",
  },
  pointsText: { fontSize: 11, fontWeight: "700", color: "#b27317" },
  iconButton: {
    width: 29,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  unread: {
    position: "absolute",
    width: 7,
    height: 7,
    borderRadius: 5,
    backgroundColor: "#ed7881",
    right: 0,
    top: 5,
  },
  content: {
    paddingHorizontal: 19,
    paddingTop: 5,
    paddingBottom: 24,
    gap: 17,
    flexGrow: 1,
  },
  homeContent: { gap: 12, paddingTop: 0, paddingBottom: 16 },
  nav: {
    flexDirection: "row",
    paddingHorizontal: 12,
    paddingTop: 8,
    borderTopWidth: 1,
    borderColor: color.line,
    gap: 5,
  },
  navItem: {
    flex: 1,
    borderRadius: 14,
    minHeight: 58,
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
  toast: {
    position: "absolute",
    bottom: 94,
    left: 20,
    right: 20,
    padding: 15,
    borderRadius: 16,
    backgroundColor: "#143c43ee",
  },
  modal: {
    flex: 1,
    backgroundColor: "#122f37aa",
    alignItems: "center",
    justifyContent: "center",
    padding: 14,
  },
  catalog: {
    width: "100%",
    maxWidth: 500,
    maxHeight: "94%",
    backgroundColor: "#fff",
    padding: 16,
    borderRadius: 22,
    gap: 12,
  },
  catalogTitle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  search: {
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: 12,
    padding: 13,
    fontSize: 15,
    color: color.ink,
  },
  catalogItem: {
    gap: 4,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
});
