import { Pressable, View } from "react-native";
import { Art } from "./art";
import {
  Btn,
  Card,
  Choices,
  Go,
  Icon,
  Notice,
  Row,
  Title,
  Txt,
  color,
  usePreview,
} from "./components";
import { gameNames } from "./game-model";
import type { ScreenId } from "./catalog";

export const gameRoutes: ScreenId[] = ["15-2", "16-0", "16-1", "16-2"];
const foods = ["커피", "크루아상", "도넛", "샌드위치", "머핀", "주스"];
function Gameplay() {
  const { gameSession: g, gameAction: act, startGame, go } = usePreview();
  if (!g)
    return (
      <>
        <Title>놀이 준비</Title>
        <Notice>놀이를 시작하면 타이머와 조작 버튼이 활성화됩니다.</Notice>
        <Btn label="시작하기" onPress={() => startGame(false)} />
      </>
    );
  return (
    <>
      <Row style={{ justifyContent: "space-between" }}>
        <Txt bold size={21}>
          {gameNames[g.kind]}
        </Txt>
        <Btn
          label="일시정지"
          icon="pause"
          kind="outline"
          small
          onPress={() => {
            act({ type: "pause", value: true });
            go("17-0");
          }}
        />
      </Row>
      <Row style={{ justifyContent: "space-between" }}>
        <Card style={{ flex: 1 }}>
          <Txt muted center size={11}>
            점수
          </Txt>
          <Txt center bold size={24}>
            {g.score}
          </Txt>
        </Card>
        <Card style={{ flex: 1 }}>
          <Txt muted center size={11}>
            남은 시간
          </Txt>
          <Txt bold center size={24}>
            00:{String(Math.ceil(g.remaining / 10)).padStart(2, "0")}
          </Txt>
        </Card>
      </Row>
      {g.kind === 0 ? (
        <>
          <View
            style={{
              height: 300,
              borderRadius: 20,
              overflow: "hidden",
              backgroundColor: "#ede1d1",
            }}
          >
            <Art name="stack" />
            <View
              style={{
                position: "absolute",
                top: 50,
                left: `${g.position * 0.64}%`,
                width: "34%",
                height: 30,
                borderRadius: 18,
                backgroundColor: "#efa8b9",
                borderBottomWidth: 5,
                borderColor: "#db8d9a",
              }}
            />
            <View
              style={{
                position: "absolute",
                bottom: 45,
                left: `${(100 - g.width) / 2}%`,
                width: `${g.width}%`,
                height: 16,
                borderRadius: 8,
                backgroundColor: color.green,
              }}
            />
          </View>
          <Txt center muted>
            가운데에 맞춰 놓아보세요 · 남은 폭 {Math.round(g.width)}%
          </Txt>
          <Btn label="놓기" onPress={() => act({ type: "place" })} />
        </>
      ) : null}
      {g.kind === 1 ? (
        <>
          <Txt center muted>
            찾은 짝 {g.matched.length / 2} / 6
          </Txt>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 9 }}>
            {g.cards.map((food, i) => {
              const open = g.open.includes(i) || g.matched.includes(i);
              return (
                <Pressable
                  key={i}
                  accessibilityRole="button"
                  accessibilityLabel={`카드 ${i + 1}${open ? ` ${foods[food]}` : ""}`}
                  disabled={g.matched.includes(i)}
                  onPress={() => act({ type: "flip", value: i })}
                  style={{
                    width: "22%",
                    aspectRatio: 0.72,
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: 14,
                    backgroundColor: open ? "#fff6e9" : "#b6e7d6",
                    borderWidth: 2,
                    borderColor: g.matched.includes(i)
                      ? color.green
                      : "#d3e7df",
                    gap: 7,
                  }}
                >
                  <Icon
                    name={
                      open
                        ? ["bag", "home", "star", "gift", "heart", "map"][food]!
                        : "star"
                    }
                    tint={open ? color.gold : "#f3fffa"}
                    size={31}
                  />
                  {open ? (
                    <Txt center size={10}>
                      {foods[food]}
                    </Txt>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        </>
      ) : null}
      {g.kind === 2 ? (
        <>
          <Card>
            <Txt center bold>
              주문 목적지 · {["카페", "베이커리", "식당"][g.target]}
            </Txt>
            <Txt center muted size={12}>
              남은 기회 {3 - g.misses}
            </Txt>
          </Card>
          <Art name="delivery" style={{ maxHeight: 290, borderRadius: 16 }} />
          <Row>
            {["← 카페", "↑ 베이커리", "→ 식당"].map((name, i) => (
              <Btn
                key={name}
                label={name}
                style={{ flex: 1 }}
                onPress={() => act({ type: "deliver", value: i })}
              />
            ))}
          </Row>
        </>
      ) : null}
      {g.kind === 3 ? (
        <>
          <Card>
            <Txt bold>주문 메뉴</Txt>
            <Txt size={19}>{g.order.map((i) => foods[i]).join(" + ")}</Txt>
          </Card>
          <Art name="order" style={{ maxHeight: 160, borderRadius: 15 }} />
          <Txt bold>
            담은 메뉴:{" "}
            {g.selected.length
              ? g.selected.map((i) => foods[i]).join(" → ")
              : "비어 있어요"}
          </Txt>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 9 }}>
            {foods.map((f, i) => (
              <Btn
                key={f}
                label={f}
                kind="outline"
                style={{ width: "30%" }}
                onPress={() => act({ type: "ingredient", value: i })}
              />
            ))}
          </View>
          <Row>
            <Btn
              label="비우기"
              kind="outline"
              style={{ flex: 1 }}
              onPress={() => act({ type: "clear" })}
            />
            <Btn
              label="제출"
              style={{ flex: 2 }}
              onPress={() => act({ type: "submit" })}
            />
          </Row>
        </>
      ) : null}
    </>
  );
}
export function PlayScreens({
  board,
  panel,
}: {
  board: number;
  panel: number;
}) {
  const {
    state,
    selection,
    choose,
    go,
    startGame,
    gameSession,
    gameAction,
    quitGame,
    setDraft,
    draft,
  } = usePreview();
  if (board === 16 || (board === 15 && panel === 2)) return <Gameplay />;
  if (board === 15 && panel === 0)
    return (
      <>
        <Title back={false}>오늘의 놀이</Title>
        <Txt muted>가벼운 놀이로 내 방에 작은 즐거움을 더해요.</Txt>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
          {gameNames.map((name, i) => (
            <Card key={name} style={{ width: "48%", padding: 10 }}>
              <Art name={`game${i}`} />
              <Txt bold center>
                {name}
              </Txt>
              <Txt muted center size={11}>
                최고 점수 {Math.max(0, ...state.scores[i]!).toLocaleString()}
              </Txt>
              <Btn
                label="시작"
                small
                onPress={() => {
                  choose({ game: i });
                  go("15-1");
                }}
              />
            </Card>
          ))}
        </View>
        <Card>
          <Txt bold>오늘의 가구 보상</Txt>
          <Row>
            <Art name="lamp" width={55} />
            <View style={{ flex: 1 }}>
              <Txt>버섯 스탠드 조명</Txt>
              <Txt muted size={11}>
                테스트 놀이 보상 · 가구와 30 P
              </Txt>
            </View>
          </Row>
        </Card>
        <Go label="놀이 기록" to="17-2" kind="outline" />
      </>
    );
  if (board === 15 && panel === 1)
    return (
      <>
        <Title>{gameNames[selection.game]}</Title>
        <Art
          name={`game${selection.game}`}
          style={{ maxHeight: 225, borderRadius: 18 }}
        />
        <Card>
          <Txt bold size={18}>
            놀이 방법
          </Txt>
          <Txt>
            {
              [
                "움직이는 마카롱이 가운데에 왔을 때 놓기를 눌러요. 어긋나면 쌓을 수 있는 폭이 줄어들어요.",
                "카드를 뒤집어 같은 그림 두 장을 찾아요. 여섯 쌍을 모두 찾으면 완료!",
                "주문 목적지를 보고 왼쪽·가운데·오른쪽 가게로 배달해요.",
                "주문에 나온 메뉴를 같은 순서로 담고 제출해요.",
              ][selection.game]
            }
          </Txt>
        </Card>
        <Card>
          <Txt bold>로컬 테스트 완주 보상</Txt>
          <Row>
            <Art name="lamp" width={65} />
            <View>
              <Txt>버섯 스탠드 조명</Txt>
              <Txt bold tint={color.gold}>
                30 P
              </Txt>
            </View>
          </Row>
          <Txt muted size={11}>
            연습에서는 보상을 지급하지 않아요.
          </Txt>
        </Card>
        <Row>
          <Btn
            label="연습하기"
            kind="outline"
            style={{ flex: 1 }}
            onPress={() => startGame(true)}
          />
          <Btn
            label="시작하기"
            style={{ flex: 1 }}
            onPress={() => startGame(false)}
          />
        </Row>
      </>
    );
  if (board === 17 && panel === 0)
    return (
      <>
        <Title>잠깐 쉬어갈까요?</Title>
        <Art
          name={`game${gameSession?.kind ?? selection.game}`}
          style={{ maxHeight: 220 }}
        />
        <Notice>나가면 이번 진행 기록은 저장되지 않아요.</Notice>
        <Btn
          label="계속하기"
          onPress={() => {
            if (!gameSession) return startGame(false);
            gameAction({ type: "pause", value: false });
            go(gameRoutes[gameSession.kind]!);
          }}
        />
        <Btn
          label="처음부터"
          kind="outline"
          onPress={() => startGame(gameSession?.practice ?? false)}
        />
        <Go label="규칙 보기" to="15-1" kind="outline" />
        <Btn
          label="나가기"
          kind="outline"
          onPress={() => {
            quitGame();
            go("15-0");
          }}
        />
      </>
    );
  if (board === 17 && panel === 1) {
    const result = state.lastResult;
    return (
      <>
        <Title back={false}>놀이 완료</Title>
        <Txt center bold size={34}>
          {(result?.score ?? 0).toLocaleString()}
        </Txt>
        <Txt center muted>
          {gameNames[result?.game ?? selection.game]}
        </Txt>
        <Art
          name="lamp"
          width={160}
          style={{ alignSelf: "center", marginVertical: 12 }}
        />
        <Txt center bold size={23}>
          버섯 스탠드 조명
        </Txt>
        <Txt center tint={color.gold} bold>
          {result?.practice
            ? "연습 기록 · 보상 없음"
            : "+30 P · 로컬 테스트 보상"}
        </Txt>
        <Btn
          label="마이룸에 배치"
          onPress={() => {
            setDraft({ ...draft, furniture: "lamp" });
            go("03-1");
          }}
        />
        <Row>
          <Btn
            label="한 번 더"
            style={{ flex: 1 }}
            kind="outline"
            onPress={() => startGame(result?.practice ?? false)}
          />
          <Go label="놀이 목록" to="15-0" kind="outline" style={{ flex: 1 }} />
        </Row>
      </>
    );
  }
  const records = state.scores[selection.game]!;
  return (
    <>
      <Title>놀이 기록</Title>
      <Choices
        labels={gameNames}
        value={selection.game}
        onChange={(i) => choose({ game: i })}
      />
      <Card>
        <Row>
          <Art name={`game${selection.game}`} width={100} />
          <View>
            <Txt bold>{gameNames[selection.game]}</Txt>
            <Txt muted>최고 기록</Txt>
            <Txt bold size={26}>
              {Math.max(0, ...records).toLocaleString()}
            </Txt>
          </View>
        </Row>
      </Card>
      <Txt bold>최근 5회 점수</Txt>
      <Row
        style={{
          height: 170,
          alignItems: "flex-end",
          justifyContent: "space-around",
        }}
      >
        {records.slice(-5).map((n, i) => (
          <View key={i} style={{ width: "15%", gap: 7 }}>
            <Txt size={11} center>
              {n}
            </Txt>
            <View
              style={{
                height: Math.max(12, (n / Math.max(1, ...records)) * 130),
                borderTopLeftRadius: 8,
                borderTopRightRadius: 8,
                backgroundColor: color.mint,
              }}
            />
          </View>
        ))}
      </Row>
      <Btn label="다시 도전" onPress={() => startGame(false)} />
    </>
  );
}
