import { useEffect, useMemo, useRef, useState } from "react";
import {
  PanResponder,
  Pressable,
  ScrollView,
  View,
  useWindowDimensions,
} from "react-native";
import { Art } from "./art";
import {
  Avatar,
  Btn,
  Card,
  Choices,
  CoinRow,
  Field,
  Go,
  Icon,
  ListLink,
  Notice,
  Row,
  Title,
  Toggle,
  Txt,
  color,
  usePreview,
} from "./components";
import {
  canVisitNeighbor,
  claimMail,
  furniture,
  neighbors,
  ownedTickets,
  sendFriendship,
  stores,
} from "./model";
import type { ScreenId } from "./catalog";

const wallColors = [
  "#f8eedf",
  "#bcdac1",
  "#f0d9c7",
  "#b8d8ed",
  "#d6d6d8",
  "#edcace",
];
export function RoomScene({
  edit = false,
  other = false,
  friend = false,
}: {
  edit?: boolean;
  other?: boolean;
  friend?: boolean;
}) {
  const { state, draft, setDraft } = usePreview();
  const room = edit ? draft : state.room;
  const rect = useRef({ width: 320, height: 240 }),
    initial = useRef({ x: 0, y: 0 });
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);
  // PanResponder stores these callbacks; refs are read only during gestures.
  /* eslint-disable react-hooks/refs */
  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => edit,
        onMoveShouldSetPanResponder: () => edit,
        onPanResponderGrant: () => {
          initial.current = { x: draftRef.current.x, y: draftRef.current.y };
        },
        onPanResponderMove: (_, g) =>
          setDraft({
            ...draftRef.current,
            x: Math.max(
              3,
              Math.min(
                80,
                initial.current.x + (g.dx / rect.current.width) * 100,
              ),
            ),
            y: Math.max(
              15,
              Math.min(
                75,
                initial.current.y + (g.dy / rect.current.height) * 100,
              ),
            ),
          }),
      }),
    [edit, setDraft],
  );
  /* eslint-enable react-hooks/refs */
  return (
    <View
      onLayout={(e) => {
        rect.current = {
          width: e.nativeEvent.layout.width,
          height: e.nativeEvent.layout.height,
        };
      }}
      style={{
        position: "relative",
        borderRadius: 18,
        overflow: "hidden",
        backgroundColor: "#fff",
      }}
    >
      <Art
        name={
          other
            ? "roomNeighbor"
            : friend
              ? "roomFriend"
              : room.wall === 1
                ? "wallRoom"
                : "room"
        }
      />
      {!other && !friend && room.wall > 1 ? (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            inset: 0,
            backgroundColor: wallColors[room.wall],
            opacity: 0.12,
          }}
        />
      ) : null}
      {!other && !friend && room.floor > 0 ? (
        <View
          pointerEvents="none"
          accessibilityLabel={`바닥 ${room.floor + 1}`}
          style={{
            position: "absolute",
            left: "12%",
            bottom: "8%",
            width: "73%",
            height: "23%",
            borderRadius: 50,
            backgroundColor: wallColors[room.floor],
            opacity: 0.7,
            transform: [{ rotate: "-5deg" }],
          }}
        />
      ) : null}
      {!other && !friend ? (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            left: "12%",
            top: "22%",
            flexDirection: "row",
            gap: 3,
          }}
        >
          {room.displayed.map((id) => {
            const coin = state.coins.find((c) => c.id === id);
            return coin ? (
              <Art
                key={id}
                name={
                  {
                    브론즈: "bronze",
                    실버: "silver",
                    골드: "gold",
                    프리즘: "prism",
                  }[coin.grade]
                }
                width={24}
              />
            ) : null;
          })}
        </View>
      ) : null}
      {!other && !friend && room.accessory > 0 ? (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            right: "20%",
            bottom: "29%",
            backgroundColor: "#fff4d9",
            borderRadius: 10,
            padding: 5,
          }}
        >
          <Txt size={18}>{["", "🧣", "🎀", "🌼"][room.accessory] ?? "✨"}</Txt>
        </View>
      ) : null}
      {!other && !friend && room.furniture ? (
        <View
          {...(edit ? pan.panHandlers : {})}
          accessibilityLabel={edit ? "배치 가구, 드래그로 이동" : "배치한 가구"}
          style={{
            position: "absolute",
            width: "16%",
            left: `${room.x}%`,
            top: `${room.y}%`,
            transform: [{ rotate: `${room.rotation}deg` }],
            borderWidth: edit ? 2 : 0,
            borderColor: color.green,
            borderRadius: 8,
            padding: 2,
            backgroundColor: "#ffffffd9",
          }}
        >
          <Art name={room.furniture} />
        </View>
      ) : null}
    </View>
  );
}
function Home() {
  const { state, go, choose } = usePreview();
  const { width } = useWindowDimensions();
  const tickets = useRef<ScrollView>(null);
  const order = ownedTickets(state);
  const visits = state.visits.cafe ?? 0;
  const target = [1, 3, 5].find((n) => n > visits);
  return (
    <>
      <Title back={false}>마이룸</Title>
      <View style={{ width: "100%", maxWidth: 280, alignSelf: "center" }}>
        <RoomScene />
        <View style={{ position: "absolute", right: 0, top: 0 }}>
          <Go label="꾸미기" icon="brush" kind="outline" small to="03-1" />
        </View>
      </View>
      <Txt size={16} bold center>
        보유 뽑기권
      </Txt>
      {order.length ? <ScrollView
        ref={tickets}
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={172}
        decelerationRate="fast"
        style={{ flexGrow: 0 }}
        contentContainerStyle={{
          gap: 14,
          paddingHorizontal: (Math.min(width, 480) - 38 - 158) / 2,
        }}
        onLayout={() => tickets.current?.scrollTo({
          x: Math.max(0, order.findIndex((s) => s.id === "cafe")) * 172,
          animated: false,
        })}
      >
        {order.map((store) => (
          <Pressable
            key={store.id}
            accessibilityRole="button"
            accessibilityLabel={`${store.name} 뽑기권 ${state.tickets[store.id]}장`}
            onPress={() => {
              choose({ store: store.id });
              go("09-0");
            }}
            style={{ width: 158, gap: 5 }}
          >
            <Art
              name={
                store.id === "cafe"
                  ? "ticket"
                  : store.id === "bakery"
                    ? "ticketBread"
                    : "ticketFood"
              }
            />
            <Row style={{ justifyContent: "center" }}>
              <Txt size={12} bold>
                {store.name}
              </Txt>
              <Txt size={12} tint={color.green}>
                {state.tickets[store.id]}장
              </Txt>
            </Row>
          </Pressable>
        ))}
      </ScrollView> : <Card><Txt center muted>보유한 뽑기권이 없어요</Txt><Go label="가게 탐색하기" to="07-0" kind="outline" /></Card>}
      <Card style={{ padding: 13 }}>
        <Row style={{ justifyContent: "space-between" }}>
          <View>
            <Txt bold size={12}>
              방문 보상
            </Txt>
            <Txt muted size={11}>
              달빛 카페 · {visits}회 방문
            </Txt>
          </View>
          <Row>
            {[1, 3, 5].map((n) => (
              <View key={n} style={{ alignItems: "center", gap: 3 }}>
                <View
                  style={{
                    borderRadius: 18,
                    padding: 6,
                    backgroundColor: visits >= n ? color.mint : "#f1f3f2",
                  }}
                >
                  <Icon
                    name={visits >= n ? "check" : "gift"}
                    size={18}
                    tint={visits >= n ? color.green : color.muted}
                  />
                </View>
                <Txt size={10}>{n}회</Txt>
              </View>
            ))}
          </Row>
        </Row>
        <Pressable accessibilityRole="button" onPress={() => { choose({ store: "cafe" }); go("07-2"); }}>
          <Txt muted center size={11}>
            {target
              ? `${target - visits}회 더 방문하면 다음 뽑기권`
              : "방문 목표를 모두 달성했어요!"}
          </Txt>
        </Pressable>
      </Card>
      <Row style={{ justifyContent: "center", gap: 18 }}>
        {[
          { label: "친구", icon: "friends", to: "01-0" },
          { label: "방문 인증", icon: "scan", to: "08-1" },
        ].map((x) => (
          <Pressable
            key={x.to}
            onPress={() => go(x.to as ScreenId)}
            accessibilityRole="button"
            accessibilityLabel={x.label}
            style={{
              flex: 1,
              maxWidth: 166,
              alignItems: "center",
              justifyContent: "center",
              gap: 11,
              minHeight: 86,
              borderRadius: 20,
              backgroundColor: "#fff",
              borderWidth: 1,
              borderColor: color.line,
            }}
          >
            <Icon name={x.icon} size={34} />
            <Txt bold size={17}>
              {x.label}
            </Txt>
          </Pressable>
        ))}
      </Row>
    </>
  );
}
function Friends({ panel }: { panel: number }) {
  const ctx = usePreview(),
    { state, selection, choose, go, update, toast } = ctx;
  const [query, setQuery] = useState("");
  const [code, setCode] = useState("");
  const [found, setFound] = useState(false);
  const [tab, setTab] = useState(0);
  const friend = selection.friend;
  if (panel === 0)
    return (
      <>
        <Title back={false}>친구</Title>
        <Choices
          labels={["친구", "가게 이웃"]}
          value={0}
          onChange={(i) => {
            if (i) go("06-0");
          }}
        />
        <Field
          label="친구 검색"
          value={query}
          onChange={setQuery}
          placeholder="이름으로 찾기"
        />
        <Go label="친구 추가" to="01-1" kind="soft" icon="friends" />
        {state.friends
          .filter((n) => n.includes(query))
          .map((name, i) => (
            <Card key={name}>
              <Pressable
                onPress={() => {
                  choose({ friend: name });
                  go("01-2");
                }}
                accessibilityRole="button"
              >
                <Row>
                  <Avatar name={["haru", "sora", "mint"][i % 3]} />
                  <View style={{ flex: 1 }}>
                    <Txt bold size={17}>
                      {name}
                    </Txt>
                    <Txt muted size={11}>
                      작은 카페를 좋아해요
                    </Txt>
                  </View>
                  <Art name="roomFriend" width={78} />
                </Row>
              </Pressable>
              <Row>
                <Btn
                  label="방문"
                  kind="outline"
                  icon="home"
                  style={{ flex: 1 }}
                  onPress={() => {
                    choose({ friend: name });
                    go("05-2");
                  }}
                />
                <Btn
                  label={
                    state.sentTo.includes(name) ? "보내기 완료" : "우정 보내기"
                  }
                  kind="soft"
                  style={{ flex: 1 }}
                  disabled={state.sentTo.includes(name)}
                  onPress={() => {
                    if (update((s) => sendFriendship(s, name)))
                      toast("우정을 보냈어요.");
                  }}
                />
              </Row>
            </Card>
          ))}
        <Txt muted center size={12}>
          오늘 우정 보내기 {state.sentTo.length} / 5
        </Txt>
      </>
    );
  if (panel === 1)
    return (
      <>
        <Title>친구 추가</Title>
        <Choices
          labels={["코드 입력", "QR 스캔"]}
          value={tab}
          onChange={setTab}
        />
        {tab === 1 ? (
          <>
            <Art name="qr" width={160} style={{ alignSelf: "center" }} />
            <Notice>
              샘플 QR이에요. 카메라를 켜지 않고 친구 찾기를 테스트합니다.
            </Notice>
          </>
        ) : null}
        <Card>
          <Field
            label="친구 코드"
            value={code}
            onChange={setCode}
            placeholder="ABCD-2345"
          />
          <Btn
            label="친구 찾기"
            onPress={() => {
              if (!code.trim()) return toast("친구 코드를 입력해 주세요.");
              setFound(true);
            }}
          />
        </Card>
        <Card>
          <Txt bold>내 친구 코드</Txt>
          <Row>
            <Art name="qr" width={94} />
            <View style={{ flex: 1, gap: 12 }}>
              <Txt bold>MOMO-7789</Txt>
              <Row>
                <Btn
                  label="복사"
                  small
                  kind="outline"
                  onPress={() => toast("테스트 친구 코드: MOMO-7789")}
                />
                <Go label="공유" to="02-1" small kind="outline" />
              </Row>
            </View>
          </Row>
        </Card>
        {found ? (
          <Card>
            <Row>
              <Avatar name="mocha" />
              <View style={{ flex: 1 }}>
                <Txt bold>모카</Txt>
                <Txt muted size={12}>
                  같은 가게에서 만나요
                </Txt>
              </View>
              <Btn
                label={
                  state.friends.includes("모카") ? "추가 완료" : "친구 추가"
                }
                small
                disabled={state.friends.includes("모카")}
                onPress={() => {
                  update((s) => ({ ...s, friends: [...s.friends, "모카"] }));
                  toast("모카를 친구로 추가했어요.");
                }}
              />
            </Row>
          </Card>
        ) : null}
      </>
    );
  return (
    <>
      <Title>{friend}의 프로필</Title>
      <Row>
        <Avatar name="haru" size={85} />
        <View>
          <Txt size={24} bold>
            {friend}
          </Txt>
          <Txt muted>작은 카페를 좋아해요</Txt>
        </View>
      </Row>
      <CoinRow store="cafe" all />
      <RoomScene friend />
      <Go label="마이룸 방문" icon="home" to="05-2" />
      <Row>
        <Go label="우정 보내기" to="02-0" kind="outline" style={{ flex: 1 }} />
        <Go label="쪽지" to="02-1" kind="outline" style={{ flex: 1 }} />
        <Go label="식사 초대" to="02-2" kind="outline" style={{ flex: 1 }} />
      </Row>
    </>
  );
}
function SocialActions({ panel }: { panel: number }) {
  const { state, selection, update, go, toast } = usePreview();
  const [message, setMessage] = useState("우리 방에 새 가구를 놓았어!");
  const [attach, setAttach] = useState(true);
  const [time, setTime] = useState("12:00 – 14:00");
  const [date, setDate] = useState("10월 10일");
  const [range, setRange] = useState(1);
  const [store, setStore] = useState(2);
  if (panel === 0)
    return (
      <>
        <Title>우정 교환</Title>
        <Row style={{ justifyContent: "center", paddingVertical: 30 }}>
          <Avatar size={88} />
          <Icon name="heart" size={42} tint="#ef7581" />
          <Avatar name="haru" size={88} />
        </Row>
        <Txt center bold size={19}>
          {selection.friend}에게 우정 보내기
        </Txt>
        <Card>
          <Row style={{ justifyContent: "space-around" }}>
            <Txt center>남은 보내기{`\n${5 - state.sentTo.length} / 5`}</Txt>
            <Txt center>테스트 우정 보상{`\n5 P`}</Txt>
          </Row>
          <Btn
            label={
              state.sentTo.includes(selection.friend)
                ? "보내기 완료"
                : "우정 보내기"
            }
            disabled={state.sentTo.includes(selection.friend)}
            onPress={() => {
              if (update((s) => sendFriendship(s, selection.friend)))
                toast("우정을 보냈어요.");
            }}
          />
        </Card>
        <Card>
          <Txt bold>소라가 보낸 우정</Txt>
          <Btn
            label={
              state.mail.find((m) => m.id === "gift-sora")?.claimed
                ? "받기 완료"
                : "우정 받기"
            }
            disabled={state.mail.find((m) => m.id === "gift-sora")?.claimed}
            kind="soft"
            onPress={() => {
              if (update((s) => claimMail(s, "gift-sora")))
                toast("5 P를 받았어요.");
            }}
          />
        </Card>
        <ListLink label="교환 내역" to="14-1" />
      </>
    );
  if (panel === 1)
    return (
      <>
        <Title>쪽지 보내기</Title>
        <Card>
          <Row>
            <Avatar name="haru" />
            <Txt bold>{selection.friend}</Txt>
          </Row>
        </Card>
        <Field
          label="쪽지 내용"
          value={message}
          onChange={setMessage}
          multiline
        />
        <Toggle label="마이룸 초대 첨부" value={attach} onChange={setAttach} />
        {attach ? <RoomScene /> : null}
        <Row>
          <Go label="취소" to="01-2" kind="outline" style={{ flex: 1 }} />
          <Btn
            label="보내기"
            style={{ flex: 2 }}
            onPress={() => {
              if (!message.trim()) return toast("내용을 입력해 주세요.");
              update((s) => ({
                ...s,
                messages: [...s.messages, `${selection.friend}: ${message}`],
                mail: [
                  {
                    id: `local-${Date.now()}`,
                    from: "내 보낸 쪽지",
                    title: `${selection.friend}에게 보낸 쪽지`,
                    message: message + (attach ? " · 마이룸 초대" : ""),
                    reward: 0,
                    read: true,
                    claimed: false,
                  },
                  ...s.mail,
                ],
              }));
              toast("테스트 우편함에 저장했어요.");
              go("19-0");
            }}
          />
        </Row>
      </>
    );
  return (
    <>
      <Title>같이 밥 먹기</Title>
      <Row>
        <Avatar name="haru" />
        <Txt bold>{selection.friend}</Txt>
      </Row>
      <Txt bold>가게 선택</Txt>
      <Choices
        labels={stores.map((s) => s.name)}
        value={store}
        onChange={setStore}
      />
      <Art
        name={stores[store]!.art}
        width={130}
        style={{ alignSelf: "center" }}
      />
      <Field label="날짜" value={date} onChange={setDate} />
      <Choices
        labels={["정확한 시간", "시간 범위"]}
        value={range}
        onChange={setRange}
      />
      <Field label="시간" value={time} onChange={setTime} />
      <Field label="하고 싶은 말" value={message} onChange={setMessage} />
      <Btn
        label="초대 보내기"
        onPress={() => {
          if (!time.trim() || !date.trim())
            return toast("날짜와 시간을 입력해 주세요.");
          update((s) => ({
            ...s,
            mail: [
              {
                id: `invite-${Date.now()}`,
                from: "내 보낸 초대",
                title: `${selection.friend}의 식사 초대`,
                message: `${stores[store]!.name} · ${date} · ${time} · ${message}`,
                reward: 0,
                read: true,
                claimed: false,
              },
              ...s.mail,
            ],
          }));
          go("19-0");
          toast("초대를 테스트 우편함에 저장했어요.");
        }}
      />
    </>
  );
}
function RoomEdit({ panel }: { panel: number }) {
  const { state, draft, setDraft, update, go, toast } = usePreview();
  const [material, setMaterial] = useState(0);
  const [undo, setUndo] = useState(draft);
  const save = () => {
    update((s) => ({ ...s, room: { ...draft } }));
    toast("마이룸을 저장했어요.");
    go("03-0");
  };
  if (panel === 0)
    return (
      <>
        <Title>마이룸</Title>
        <Txt center muted>
          {state.room.visibility}에게 공개
        </Txt>
        <RoomScene />
        <Row>
          <Go
            label="꾸미기"
            icon="brush"
            to="03-1"
            kind="soft"
            style={{ flex: 1 }}
          />
          <Go
            label="친구 초대"
            icon="friends"
            to="02-1"
            kind="outline"
            style={{ flex: 1 }}
          />
        </Row>
        <Row>
          <Go label="방문자" to="05-1" kind="outline" style={{ flex: 1 }} />
          <Go label="공개 설정" to="05-0" kind="outline" style={{ flex: 1 }} />
        </Row>
        <Btn
          label="사진 저장 안내"
          kind="outline"
          onPress={() => toast("이 로컬 버전은 화면 캡처로 저장할 수 있어요.")}
        />
      </>
    );
  if (panel === 1)
    return (
      <>
        <Title>가구 배치</Title>
        <RoomScene edit />
        <Notice>
          가구를 드래그하거나 아래 이동 버튼으로 위치를 바꿔보세요.
        </Notice>
        <Row>
          <Go label="가구" to="03-1" small kind="soft" style={{ flex: 1 }} />
          <Go
            label="벽·바닥"
            to="03-2"
            small
            kind="outline"
            style={{ flex: 1 }}
          />
          <Go label="전시" to="04-0" small kind="outline" style={{ flex: 1 }} />
          <Go label="동행" to="04-1" small kind="outline" style={{ flex: 1 }} />
        </Row>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 12 }}
        >
          {furniture
            .filter((f) => state.ownedFurniture.includes(f.id))
            .map((f) => (
              <Pressable
                key={f.id}
                accessibilityRole="button"
                onPress={() => {
                  setUndo(draft);
                  setDraft({ ...draft, furniture: f.id });
                }}
                style={{
                  width: 86,
                  padding: 8,
                  borderRadius: 13,
                  borderWidth: 1,
                  borderColor:
                    draft.furniture === f.id ? color.green : color.line,
                  backgroundColor: "#fff",
                }}
              >
                <Art name={f.art} style={{ height: 75 }} />
                <Txt size={10} center>
                  {f.name}
                </Txt>
              </Pressable>
            ))}
        </ScrollView>
        <Row>
          {[
            ["←", -5, 0],
            ["→", 5, 0],
            ["↑", 0, -5],
            ["↓", 0, 5],
          ].map(([label, x, y]) => (
            <Btn
              key={String(label)}
              label={String(label)}
              kind="outline"
              small
              style={{ flex: 1 }}
              onPress={() => {
                setUndo(draft);
                setDraft({
                  ...draft,
                  x: Math.max(3, Math.min(80, draft.x + Number(x))),
                  y: Math.max(15, Math.min(75, draft.y + Number(y))),
                });
              }}
            />
          ))}
        </Row>
        <Row>
          <Btn
            label="되돌리기"
            small
            kind="outline"
            onPress={() => setDraft(undo)}
          />
          <Btn
            label="회전"
            small
            kind="outline"
            onPress={() => {
              setUndo(draft);
              setDraft({ ...draft, rotation: (draft.rotation + 90) % 360 });
            }}
          />
          <Btn
            label="보관"
            small
            kind="outline"
            onPress={() => {
              setUndo(draft);
              setDraft({ ...draft, furniture: "" });
            }}
          />
        </Row>
        <Row>
          <Btn
            label="취소"
            kind="outline"
            style={{ flex: 1 }}
            onPress={() => {
              setDraft({ ...state.room });
              go("03-0");
            }}
          />
          <Btn label="배치 저장" style={{ flex: 2 }} onPress={save} />
        </Row>
      </>
    );
  return (
    <>
      <Title>벽과 바닥</Title>
      <RoomScene edit />
      <Choices
        labels={["벽지", "바닥"]}
        value={material}
        onChange={setMaterial}
      />
      <Txt bold>{material ? "보유 바닥" : "보유 벽지"}</Txt>
      <Row style={{ flexWrap: "wrap" }}>
        {wallColors.map((c, i) => (
          <Pressable
            key={c}
            accessibilityRole="button"
            accessibilityLabel={`${material ? "바닥" : "벽지"} ${i + 1}`}
            onPress={() =>
              setDraft({ ...draft, [material ? "floor" : "wall"]: i })
            }
            style={{
              width: "29%",
              height: 64,
              borderRadius: 12,
              backgroundColor: material
                ? [
                    "#dcc3a2",
                    "#f1f2ef",
                    "#b6b8ba",
                    "#d5cabc",
                    "#bb8e67",
                    "#756454",
                  ][i]
                : c,
              borderWidth: (material ? draft.floor : draft.wall) === i ? 3 : 1,
              borderColor:
                (material ? draft.floor : draft.wall) === i
                  ? color.green
                  : color.line,
              justifyContent: "center",
              alignItems: "center",
            }}
          >
            {(material ? draft.floor : draft.wall) === i ? (
              <Icon name="check" />
            ) : null}
          </Pressable>
        ))}
      </Row>
      <Txt muted center size={12}>
        선택한 {material ? "바닥" : "벽지"} ·{" "}
        {(material ? draft.floor : draft.wall) + 1}번
      </Txt>
      <Btn label="적용" onPress={save} />
    </>
  );
}
function Customization({ panel }: { panel: number }) {
  const { state, draft, setDraft, update, go, toast } = usePreview();
  const [theme, setTheme] = useState(state.navTheme);
  const [accent, setAccent] = useState(state.accent);
  const [style, setStyle] = useState(state.iconStyle);
  if (panel === 0)
    return (
      <>
        <Title>코인 전시</Title>
        <Art name="display" />
        <Txt bold>보유 코인</Txt>
        <Row style={{ flexWrap: "wrap" }}>
          {state.coins.map((c) => (
            <Pressable
              key={c.id}
              accessibilityRole="button"
              accessibilityState={{ selected: draft.displayed.includes(c.id) }}
              onPress={() =>
                setDraft({
                  ...draft,
                  displayed: draft.displayed.includes(c.id)
                    ? draft.displayed.filter((id) => id !== c.id)
                    : [...draft.displayed, c.id].slice(-4),
                })
              }
              style={{
                width: "30%",
                padding: 9,
                borderWidth: 1,
                borderColor: draft.displayed.includes(c.id)
                  ? color.green
                  : color.line,
                borderRadius: 12,
                backgroundColor: "#fff",
              }}
            >
              <Art
                name={
                  c.grade === "브론즈"
                    ? "bronze"
                    : c.grade === "실버"
                      ? "silver"
                      : c.grade === "골드"
                        ? "gold"
                        : "prism"
                }
              />
              <Txt size={11} center>
                {c.family}
              </Txt>
              <Txt size={10} center muted>
                {c.grade} {draft.displayed.includes(c.id) ? "✓" : ""}
              </Txt>
            </Pressable>
          ))}
        </Row>
        <Btn
          label="전시 저장"
          onPress={() => {
            update((s) => ({ ...s, room: { ...draft } }));
            go("03-0");
            toast("전시 코인을 저장했어요.");
          }}
        />
      </>
    );
  if (panel === 1)
    return (
      <>
        <Title>동행 꾸미기</Title>
        <Art name={draft.accessory ? "scarfCat" : "cat"} />
        <Choices
          labels={["동행", "모자", "의상", "소품"]}
          value={3}
          onChange={() => toast("이 시안에서는 소품을 바꿔볼 수 있어요.")}
        />
        <Choices
          labels={["기본", "파란 스카프", "리본", "꽃"]}
          value={draft.accessory}
          onChange={(i) => setDraft({ ...draft, accessory: i })}
        />
        <Txt center muted>
          {
            ["기본 모습", "파란 스카프", "빨간 리본", "하얀 꽃"][
              draft.accessory
            ]
          }{" "}
          선택
        </Txt>
        <Row>
          <Btn
            label="원래대로"
            kind="outline"
            style={{ flex: 1 }}
            onPress={() => setDraft({ ...draft, accessory: 0 })}
          />
          <Btn
            label="장착하기"
            style={{ flex: 1 }}
            onPress={() => {
              update((s) => ({ ...s, room: { ...draft } }));
              toast("꾸미기를 저장했어요.");
              go("03-0");
            }}
          />
        </Row>
      </>
    );
  return (
    <>
      <Title>하단 바 꾸미기</Title>
      <Card>
        <Txt bold>미리보기</Txt>
        <Row
          style={{
            justifyContent: "space-around",
            padding: 15,
            borderRadius: 14,
            backgroundColor:
              theme === "wood"
                ? "#ddae79"
                : theme === "night"
                  ? "#25324c"
                  : color.mint,
          }}
        >
          {["map", "book", "home", "game", "bag"].map((icon) => (
            <Icon
              key={icon}
              name={icon}
              tint={theme === "night" ? "#fff" : accent}
            />
          ))}
        </Row>
      </Card>
      <Txt bold>테마</Txt>
      <Choices
        labels={["기본 민트", "따뜻한 우드", "밤하늘"]}
        value={["mint", "wood", "night"].indexOf(theme)}
        onChange={(i) => setTheme((["mint", "wood", "night"] as const)[i]!)}
      />
      <Txt bold>아이콘</Txt>
      <Choices
        labels={["채운 아이콘", "라인 아이콘"]}
        value={style === "filled" ? 0 : 1}
        onChange={(i) => setStyle(i ? "line" : "filled")}
      />
      <Txt bold>포인트 색상</Txt>
      <Row style={{ justifyContent: "space-between" }}>
        {["#178773", "#397bc5", "#8665b4", "#c36d77", "#a77d14"].map((c) => (
          <Pressable
            key={c}
            accessibilityRole="button"
            accessibilityLabel={`포인트 색상 ${c}`}
            onPress={() => setAccent(c)}
            style={{
              width: 42,
              height: 42,
              borderRadius: 24,
              backgroundColor: c,
              justifyContent: "center",
              alignItems: "center",
            }}
          >
            {accent === c ? <Icon name="check" tint="white" /> : null}
          </Pressable>
        ))}
      </Row>
      <Row>
        <Btn
          label="기본값"
          kind="outline"
          style={{ flex: 1 }}
          onPress={() => {
            setTheme("mint");
            setStyle("filled");
            setAccent(color.green);
          }}
        />
        <Btn
          label="적용"
          style={{ flex: 2 }}
          onPress={() => {
            update((s) => ({
              ...s,
              navTheme: theme,
              accent,
              iconStyle: style,
            }));
            toast("하단 바를 바꿨어요.");
          }}
        />
      </Row>
    </>
  );
}
function Visitors({ panel }: { panel: number }) {
  const { state, selection, update, go, toast, choose } = usePreview();
  const [welcome, setWelcome] = useState(state.room.welcome);
  const [visibility, setVisibility] = useState(state.room.visibility);
  const [note, setNote] = useState("따뜻한 방이네요!");
  if (panel === 0)
    return (
      <>
        <Title>방문 공개 설정</Title>
        <RoomScene />
        <Field
          label="방문 환영 메시지"
          value={welcome}
          onChange={setWelcome}
          maxLength={60}
        />
        <Txt bold>방문 공개 범위</Txt>
        {(["나만 보기", "친구", "같은 가게 이웃"] as const).map((v) => (
          <Btn
            key={v}
            label={`${visibility === v ? "✓  " : ""}${v}`}
            kind={visibility === v ? "soft" : "outline"}
            onPress={() => setVisibility(v)}
          />
        ))}
        <Notice>
          같은 가게 이웃은 내가 방문한 가게로 연결된 이웃에게 방을 공개해요.
        </Notice>
        <Toggle
          label="방명록 받기"
          value={state.room.guestbook}
          onChange={(v) =>
            update((s) => ({ ...s, room: { ...s.room, guestbook: v } }))
          }
        />
        <Toggle
          label="방문 알림"
          value={state.room.alerts}
          onChange={(v) =>
            update((s) => ({ ...s, room: { ...s.room, alerts: v } }))
          }
        />
        <Btn
          label="저장"
          onPress={() => {
            update((s) => ({ ...s, room: { ...s.room, visibility, welcome } }));
            toast("공개 설정을 저장했어요.");
            go("03-0");
          }}
        />
      </>
    );
  if (panel === 1)
    return (
      <>
        <Title>우리 방 방문자</Title>
        <Choices
          labels={["방문자", "방명록"]}
          value={0}
          onChange={() => toast("아래에서 방명록을 확인할 수 있어요.")}
        />
        {["하루", "소라", "모카"].map((name, i) => (
          <Card key={name}>
            <Row>
              <Avatar name={i === 0 ? "haru" : i === 1 ? "sora" : "mocha"} />
              <View style={{ flex: 1 }}>
                <Txt bold>{name}</Txt>
                <Txt size={11} muted>
                  {i < 2 ? "친구" : "달빛 카페 이웃"}
                </Txt>
              </View>
              <Btn
                label="답방"
                kind="soft"
                small
                onPress={() => {
                  choose({ friend: name, neighbor: "mocha" });
                  go(i < 2 ? "05-2" : "06-2");
                }}
              />
            </Row>
          </Card>
        ))}
        <Txt bold>최근 방명록</Txt>
        {state.guestbook.map((s, i) => (
          <Card key={i}>
            <Txt>{s}</Txt>
          </Card>
        ))}
        <Go label="친구 초대" to="02-1" kind="outline" icon="friends" />
      </>
    );
  return (
    <>
      <Title>{selection.friend}의 마이룸</Title>
      <RoomScene friend />
      <Btn
        label={
          state.liked.includes(selection.friend) ? "좋아요 했어요" : "좋아요"
        }
        icon="heart"
        kind="soft"
        onPress={() =>
          update((s) => ({
            ...s,
            liked: s.liked.includes(selection.friend)
              ? s.liked.filter((n) => n !== selection.friend)
              : [...s.liked, selection.friend],
          }))
        }
      />
      <Field label="방명록" value={note} onChange={setNote} />
      <Btn
        label="방명록 남기기"
        kind="outline"
        onPress={() => {
          if (!note.trim()) return toast("내용을 입력해 주세요.");
          update((s) => ({
            ...s,
            guestbook: [
              ...s.guestbook,
              `${s.nickname} → ${selection.friend} · ${note}`,
            ],
          }));
          setNote("");
          toast("테스트 방명록에 남겼어요.");
        }}
      />
      <Go label="우정 보내기" to="02-0" kind="outline" />
      <Go label="친구 프로필" to="01-2" kind="outline" />
    </>
  );
}
function Neighbors({ panel }: { panel: number }) {
  const { state, selection, choose, go, update, toast } = usePreview();
  const [note, setNote] = useState("방 구경 잘했어요!");
  const store = stores.find((s) => s.id === selection.store) ?? stores[0];
  const accessible = neighbors.filter(
    (n) => n.store === store.id && canVisitNeighbor(state, n),
  );
  const neighbor =
    neighbors.find((n) => n.id === selection.neighbor) ?? accessible[0];
  const randomVisit = () => {
    const options = accessible.filter((n) => n.id !== selection.neighbor);
    const next =
      // This handler runs only on a user press, never while rendering.
      // eslint-disable-next-line react-hooks/purity
      options[Math.floor(Math.random() * options.length)] ?? accessible[0];
    if (!next) return toast("방문할 수 있는 공개 마이룸이 없어요.");
    choose({ neighbor: next.id });
    go("06-2");
  };
  if (panel === 0)
    return (
      <>
        <Title>가게 이웃</Title>
        <Txt muted>같은 가게에서 이어진 우리</Txt>
        {stores
          .filter((s) => (state.visits[s.id] ?? 0) > 0)
          .map((s) => (
            <Card key={s.id}>
              <Row>
                <Art name={s.art} width={102} />
                <View style={{ flex: 1, gap: 8 }}>
                  <Txt bold size={18}>
                    {s.name}
                  </Txt>
                  <Txt size={12} tint={color.green}>
                    ✓ 방문 인증 완료
                  </Txt>
                  <Txt muted size={11}>
                    같은 가게를 방문한 공개 이웃
                  </Txt>
                  <Btn
                    label="이웃 만나기"
                    small
                    onPress={() => {
                      choose({ store: s.id });
                      go("06-1");
                    }}
                  />
                </View>
              </Row>
            </Card>
          ))}
      </>
    );
  if (panel === 1)
    return (
      <>
        <Title>{store.name} 이웃</Title>
        <View
          style={{
            minHeight: 280,
            alignItems: "center",
            justifyContent: "center",
            gap: 18,
          }}
        >
          <Row style={{ justifyContent: "space-evenly", width: "100%" }}>
            {accessible.slice(0, 2).map((n) => (
              <Pressable
                key={n.id}
                accessibilityRole="button"
                onPress={() => {
                  choose({ neighbor: n.id });
                  go("06-2");
                }}
                style={{ alignItems: "center", gap: 5 }}
              >
                <Avatar name={n.art} size={66} />
                <Txt size={12}>{n.name}</Txt>
                <View
                  style={{ width: 2, height: 32, backgroundColor: "#bdd7e4" }}
                />
              </Pressable>
            ))}
          </Row>
          <Art name="neighborCafe" width={115} />
        </View>
        <Txt bold center size={18}>
          같은 가게를 방문한 공개 마이룸
        </Txt>
        <Txt center muted>
          친구가 아니어도 이웃의 방에 놀러 갈 수 있어요.
        </Txt>
        <Btn label="랜덤 마이룸 방문" icon="shuffle" onPress={randomVisit} />
        <Go label="다른 가게 선택" to="06-0" kind="outline" />
      </>
    );
  if (!neighbor || !canVisitNeighbor(state, neighbor))
    return (
      <>
        <Title>마이룸 방문</Title>
        <Notice>지금은 방문할 수 없는 방이에요.</Notice>
        <Go label="공개 이웃 보기" to="06-0" />
      </>
    );
  return (
    <>
      <Title>{neighbor.name}의 마이룸</Title>
      <Txt center muted>
        {stores.find((s) => s.id === neighbor.store)?.name}로 이어진 이웃
      </Txt>
      <Txt center size={12}>
        친구가 아니어도 방문 가능해요.
      </Txt>
      <RoomScene other />
      <Btn label="다음 랜덤 방문" icon="shuffle" onPress={randomVisit} />
      <Row>
        <Btn
          label={state.friends.includes(neighbor.name) ? "친구" : "친구 추가"}
          kind="outline"
          style={{ flex: 1 }}
          disabled={state.friends.includes(neighbor.name)}
          onPress={() => {
            update((s) => ({ ...s, friends: [...s.friends, neighbor.name] }));
            toast("친구로 추가했어요.");
          }}
        />
        <Btn
          label={state.liked.includes(neighbor.name) ? "좋아요 ✓" : "좋아요"}
          kind="soft"
          style={{ flex: 1 }}
          onPress={() =>
            update((s) => ({
              ...s,
              liked: s.liked.includes(neighbor.name)
                ? s.liked.filter((n) => n !== neighbor.name)
                : [...s.liked, neighbor.name],
            }))
          }
        />
      </Row>
      <Field label="방명록" value={note} onChange={setNote} />
      <Btn
        label="방명록 남기기"
        kind="outline"
        onPress={() => {
          if (!note.trim()) return toast("내용을 입력해 주세요.");
          update((s) => ({
            ...s,
            guestbook: [
              ...s.guestbook,
              `${s.nickname} → ${neighbor.name} · ${note}`,
            ],
          }));
          setNote("");
          toast("테스트 방명록에 저장했어요.");
        }}
      />
    </>
  );
}
export function SocialScreens({
  board,
  panel,
}: {
  board: number;
  panel: number;
}) {
  switch (board) {
    case 0:
      return <Home />;
    case 1:
      return <Friends panel={panel} />;
    case 2:
      return <SocialActions panel={panel} />;
    case 3:
      return <RoomEdit panel={panel} />;
    case 4:
      return <Customization panel={panel} />;
    case 5:
      return <Visitors panel={panel} />;
    case 6:
      return <Neighbors panel={panel} />;
    default:
      return null;
  }
}
