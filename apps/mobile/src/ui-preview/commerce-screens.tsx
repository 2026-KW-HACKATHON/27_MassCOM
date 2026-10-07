import { useState } from "react";
import { Pressable, View } from "react-native";
import { Art } from "./art";
import {
  Btn,
  Card,
  Choices,
  CoinRow,
  Field,
  Go,
  Icon,
  ListLink,
  Notice,
  Price,
  Row,
  Title,
  Txt,
  color,
  usePreview,
} from "./components";
import {
  buyFurniture,
  coinFamilies,
  collectionProgress,
  drawCoin,
  finishNft,
  furniture,
  grades,
  requestNft,
  rerollCoin,
  rerollUnavailable,
  stores,
  visitStore,
} from "./model";

function Explore({ panel }: { panel: number }) {
  const { state, selection, choose, go, toast, update } = usePreview();
  const [query, setQuery] = useState(selection.query ?? "");
  const [category, setCategory] = useState(selection.category ?? 0);
  const [map, setMap] = useState(true);
  const store = stores.find((s) => s.id === selection.store) ?? stores[0];
  const filtered = stores.filter(
    (s) =>
      (s.name.includes(query) || s.type.includes(query)) &&
      (category === 0 ||
        (category === 1
          ? s.type === "카페"
          : category === 2
            ? s.type === "음식점"
            : !(state.visits[s.id] > 0))),
  );
  if (panel === 2)
    return (
      <>
        <Title>{store.name}</Title>
        <Art
          name={store.id === "cafe" ? "cafeWide" : store.art}
          style={{ borderRadius: 16, maxHeight: 230 }}
        />
        <Txt bold size={22}>
          {store.name}
        </Txt>
        <Txt muted>
          {store.type} · 도보 {store.minutes}분
        </Txt>
        <Txt>매일 10:00 – 22:00{`\n`}행복동 달빛로 12</Txt>
        <Notice>가게·주소·지도는 로컬 UI 확인용 예시입니다.</Notice>
        <Row>
          <Go label="길찾기" to="08-0" kind="outline" style={{ flex: 1 }} />
          <Btn
            label="전화"
            kind="outline"
            style={{ flex: 1 }}
            onPress={() => toast("테스트 가게에는 전화를 걸지 않아요.")}
          />
          <Btn
            label={state.settings[`savedStore:${store.id}`] ? "저장됨" : "저장"}
            kind="outline"
            style={{ flex: 1 }}
            onPress={() => update((s) => ({ ...s, settings: { ...s.settings,
              [`savedStore:${store.id}`]: !s.settings[`savedStore:${store.id}`],
            } }))}
          />
        </Row>
        <Card>
          <Txt bold>수집 현황</Txt>
          <CoinRow store={store.id} />
          <Go label="가게 도감" to="10-1" kind="soft" />
        </Card>
        <ListLink label="같은 가게 이웃" to="06-1" icon="friends" />
        <Go label="방문 인증" to="08-1" />
      </>
    );
  const renderStore = (s: (typeof stores)[number]) => (
    <Pressable
      key={s.id}
      accessibilityRole="button"
      accessibilityLabel={`${s.name} 상세`}
      onPress={() => {
        choose({ store: s.id });
        go("07-2");
      }}
    >
      <Card>
        <Row>
          <Art name={s.art} width={90} />
          <View style={{ flex: 1, gap: 7 }}>
            <Txt bold size={17}>
              {s.name}
            </Txt>
            <Txt muted size={12}>
              {s.type} · 도보 {s.minutes}분
            </Txt>
            <CoinRow store={s.id} />
          </View>
        </Row>
      </Card>
    </Pressable>
  );
  return (
    <>
      <Title back={panel !== 0}>
        {panel === 0 ? "동네 탐색" : "검색 결과"}
      </Title>
      <Field
        label="가게·동네 검색"
        value={query}
        onChange={(value) => { setQuery(value); choose({ query: value }); }}
        placeholder="카페, 식당, 가게 이름"
      />
      <Choices
        labels={["전체", "카페", "음식점", "미방문"]}
        value={category}
        onChange={(value) => { setCategory(value); choose({ category: value }); }}
      />
      {panel === 0 && map ? (
        <View style={{ position: "relative" }}>
          <Art name="map" style={{ borderRadius: 18 }} />
          {filtered.map((s, i) => (
            <Pressable
              key={s.id}
              onPress={() => {
                choose({ store: s.id });
                go("07-2");
              }}
              accessibilityRole="button"
              accessibilityLabel={`${s.name} 지도 핀`}
              style={{
                position: "absolute",
                left: `${24 + i * 24}%`,
                top: `${20 + i * 13}%`,
                backgroundColor: "#fff",
                padding: 8,
                borderRadius: 20,
                borderColor: color.green,
                borderWidth: 2,
              }}
            >
              <Icon name="map" tint={color.green} size={23} />
            </Pressable>
          ))}
          <View style={{ position: "absolute", right: 12, bottom: 12 }}>
            <Btn
              label="목록 보기"
              kind="outline"
              small
              onPress={() => setMap(false)}
            />
          </View>
        </View>
      ) : null}
      {filtered.length ? (
        filtered.map(renderStore)
      ) : (
        <Notice>검색 결과가 없어요. 다른 이름으로 찾아보세요.</Notice>
      )}
      <Row>
        <Btn
          label="지도에서 보기"
          kind="soft"
          style={{ flex: 1 }}
          onPress={() => {
            setMap(true);
            go("07-0");
          }}
        />
        <Go label="검색 결과" to="07-1" kind="outline" style={{ flex: 1 }} />
      </Row>
    </>
  );
}
function Visit({ panel }: { panel: number }) {
  const { state, selection, update, go, toast } = usePreview();
  const [code, setCode] = useState("");
  const [mode, setMode] = useState(0);
  const store = stores.find((s) => s.id === selection.store) ?? stores[0];
  const visits = state.visits[store.id] ?? 0;
  if (panel === 0)
    return (
      <>
        <Title>길찾기</Title>
        <Card>
          <Txt muted>출발지</Txt>
          <Txt bold>현재 위치 · 샘플</Txt>
          <Txt muted>도착지</Txt>
          <Txt bold>{store.name}</Txt>
        </Card>
        <Choices
          labels={["도보", "자동차", "대중교통"]}
          value={mode}
          onChange={setMode}
        />
        <Art name="map" style={{ borderRadius: 18 }} />
        <Card>
          <Txt bold size={23}>
            {mode === 0 ? "도보" : mode === 1 ? "자동차" : "대중교통"}{" "}
            {mode === 0 ? store.minutes : mode === 1 ? 3 : 8}분
          </Txt>
          <Txt muted>약 350 m · 평평한 길이에요.</Txt>
        </Card>
        <Notice>이 테스트 앱에서는 실제 위치를 조회하지 않아요.</Notice>
        <Go label="도착했어요 · 방문 인증" to="08-1" />
      </>
    );
  if (panel === 1)
    return (
      <>
        <Title>방문 인증</Title>
        <View style={{ height: 275, overflow: "hidden", borderRadius: 20 }}>
          <Art name="scan" />
          <View
            style={{
              position: "absolute",
              left: 14,
              top: 14,
              right: 14,
              backgroundColor: "#ffffffec",
              padding: 10,
              borderRadius: 10,
            }}
          >
            <Txt center bold>
              샘플 QR로 방문 화면을 테스트해요.
            </Txt>
          </View>
        </View>
        <Field
          label="방문 코드"
          value={code}
          onChange={setCode}
          placeholder="MOON-2026"
        />
        <Btn
          label="방문 인증"
          onPress={() => {
            if (code.trim().toUpperCase() !== "MOON-2026")
              return toast("샘플 코드 MOON-2026을 입력해 주세요.");
            if (update((s) => visitStore(s, store.id))) go("08-2");
          }}
        />
        <Notice>
          테스트 코드: MOON-2026. 실제 방문·카메라 인증은 실행하지 않습니다.
        </Notice>
        <Go label="취소" to="00-0" kind="outline" />
      </>
    );
  const rewarded = [1, 3, 5].includes(visits);
  return (
    <>
      <View style={{ alignItems: "center", paddingTop: 25 }}>
        <View
          style={{ backgroundColor: color.mint, borderRadius: 50, padding: 20 }}
        >
          <Icon name="check" size={48} tint={color.green} />
        </View>
      </View>
      <Title back={false}>방문 완료</Title>
      <Txt center bold size={20}>
        {store.name}
      </Txt>
      <Txt center muted>
        {visits}번째 방문을 인증했어요!
      </Txt>
      {rewarded ? (
        <>
          <Art name="ticket" style={{ maxWidth: 280, alignSelf: "center" }} />
          <Txt center bold size={20}>
            가게 뽑기권 1장
          </Txt>
          <Go label="뽑기권 열기" to="09-0" />
        </>
      ) : (
        <Notice>방문 목표 1·3·5회를 달성하면 뽑기권을 받을 수 있어요.</Notice>
      )}
      <Go label="가게 도감" to="10-1" kind="outline" />
      <Card>
        <Txt>
          다음 목표 · {visits < 3 ? "3" : visits < 5 ? "5" : "달성 완료"}회
          방문하기
        </Txt>
        <Txt muted>{visits} / 5</Txt>
      </Card>
    </>
  );
}
function Draw({ panel }: { panel: number }) {
  const { state, selection, choose, update, go, toast } = usePreview();
  const [pool, setPool] = useState(false);
  const [requestId] = useState(() => `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const store = stores.find((s) => s.id === selection.store) ?? stores[0];
  const coin = state.lastResult?.coin;
  if (panel === 2)
    return (
      <>
        <Title back={false}>새 코인을 얻었어요</Title>
        {coin ? (
          <>
            <Art
              name={
                ["bronze", "silver", "gold", "prism"][
                  grades.indexOf(coin.grade)
                ]!
              }
              width={220}
              style={{ alignSelf: "center", marginVertical: 20 }}
            />
            <Txt center tint={color.green} bold>
              {coin.grade}
            </Txt>
            <Txt center size={26} bold>
              {coin.family}
            </Txt>
            <Txt center muted>
              {stores.find((s) => s.id === coin.store)?.name}
            </Txt>
            <Btn
              label="도감에서 보기"
              icon="book"
              onPress={() => {
                choose({ coin: coin.id, store: coin.store });
                go("10-2");
              }}
            />
            <Btn
              label="대표로 설정"
              kind="outline"
              onPress={() => {
                update((s) => ({ ...s, representative: coin.id }));
                toast("대표 코인으로 설정했어요.");
              }}
            />
            <Go label="마이룸에 전시" to="04-0" kind="outline" />
          </>
        ) : (
          <>
            <Notice>아직 뽑기 결과가 없어요.</Notice>
            <Go label="뽑기권 보기" to="09-0" />
          </>
        )}
      </>
    );
  return (
    <>
      <Title>
        {panel === 1 ? "뽑기권을 사용할까요?" : `${store.name} 뽑기권`}
      </Title>
      <Art name="ticket" style={{ maxWidth: 300, alignSelf: "center" }} />
      <Txt bold center>
        보유 {state.tickets[store.id] ?? 0}장
      </Txt>
      <Card>
        <Txt bold>획득 가능한 코인 등급</Txt>
        <CoinRow store={store.id} all />
        {panel === 1 ? (
          <Notice>
            뽑기권 1장으로 새 코인을 받아요. 기존 보유 코인은 그대로 유지돼요.
          </Notice>
        ) : (
          <Btn
            label="가게 풀 보기"
            kind="outline"
            onPress={() => setPool(!pool)}
          />
        )}
        {pool ? (
          <Row style={{ justifyContent: "space-around" }}>
            {grades.map((g, i) => (
              <Txt key={g} size={11} center>
                {g}
                {`\n`}
                {state.pool[store.id]?.[i]}개
              </Txt>
            ))}
          </Row>
        ) : null}
      </Card>
      {panel === 1 ? (
        <Row>
          <Go label="취소" to="09-0" kind="outline" style={{ flex: 1 }} />
          <Btn
            label="1장 사용하기"
            style={{ flex: 2 }}
            disabled={!(state.tickets[store.id] > 0)}
            onPress={() => {
              if (update((s) => drawCoin(s, store.id, Math.random(), requestId))) go("09-2");
            }}
          />
        </Row>
      ) : (
        <Go
          label="사용하기"
          to="09-1"
          disabled={!(state.tickets[store.id] > 0)}
        />
      )}
    </>
  );
}
function Collection({ panel }: { panel: number }) {
  const { state, selection, choose, go, update, toast } = usePreview();
  const [query, setQuery] = useState("");
  const filter = Number(state.settings.collectionFilter ?? 0);
  const sort = Number(state.settings.collectionSort ?? 0);
  const setFilter = (value: number) =>
    update((s) => ({
      ...s,
      settings: { ...s.settings, collectionFilter: value },
    }));
  const countFor = (id: string) => {
    const p = collectionProgress(state, id);
    return p.owned / p.total;
  };
  const store = stores.find((s) => s.id === selection.store) ?? stores[0];
  const coin =
    state.coins.find((c) => c.id === selection.coin) ??
    state.coins.find((c) => c.store === store.id);
  if (panel === 0)
    return (
      <>
        <Title back={false}>가게별 도감</Title>
        <Field
          label="가게 이름으로 검색하기"
          value={query}
          onChange={setQuery}
        />
        <Row>
          <View style={{ flex: 1 }}>
            <Choices
              labels={["전체", "수집 중", "완성", "미방문"]}
              value={filter}
              onChange={setFilter}
            />
          </View>
          <Go label="정렬" to="11-0" small kind="outline" />
        </Row>
        {stores
          .filter((s) => s.name.includes(query))
          .filter((s) => {
            const { owned: count, total } = collectionProgress(state, s.id);
            return (
              filter === 0 ||
              (filter === 1
                ? count > 0 && count < total
                : filter === 2
                  ? count === total
                  : (state.visits[s.id] ?? 0) === 0)
            );
          })
          .filter(
            (s) =>
              !state.settings.collectionGrade ||
              state.coins.some(
                (c) =>
                  c.store === s.id &&
                  grades.indexOf(c.grade) ===
                    Number(state.settings.collectionGrade) - 1,
              ),
          )
          .sort((a, b) =>
            sort === 2
              ? a.name.localeCompare(b.name, "ko")
              : sort === 1
                ? countFor(b.id) - countFor(a.id)
                : Math.max(
                    -1,
                    ...state.coins.map((c, i) => (c.store === b.id ? i : -1)),
                  ) -
                  Math.max(
                    -1,
                    ...state.coins.map((c, i) => (c.store === a.id ? i : -1)),
                  ),
          )
          .map((s) => (
            <Pressable
              key={s.id}
              accessibilityRole="button"
              onPress={() => {
                choose({ store: s.id });
                go("10-1");
              }}
            >
              <Card>
                <Row>
                  <Art name={s.art} width={83} />
                  <View style={{ flex: 1, gap: 9 }}>
                    <Txt bold size={17}>
                      {s.name}
                    </Txt>
                    {coinFamilies(state, s.id).map((family) => <View key={family}>
                      <Txt size={12}>{family}</Txt>
                      <CoinRow store={s.id} family={family} />
                    </View>)}
                  </View>
                </Row>
              </Card>
            </Pressable>
          ))}
      </>
    );
  if (panel === 1)
    return (
      <>
        <Title>{store.name} 도감</Title>
        <Art
          name={store.id === "cafe" ? "cafeWide" : store.art}
          style={{ maxHeight: 180, borderRadius: 16 }}
        />
        {Array.from(
          new Set([
            store.family,
            ...state.coins
              .filter((c) => c.store === store.id)
              .map((c) => c.family),
          ]),
        ).map((family) => (
          <Card key={family}>
            <Txt size={18} bold>
              {family}
            </Txt>
            <Txt muted size={12}>
              등급 수집{" "}
              {
                new Set(
                  state.coins
                    .filter((c) => c.store === store.id && c.family === family)
                    .map((c) => c.grade),
                ).size
              }{" "}
              / 4
            </Txt>
            <Row style={{ flexWrap: "wrap" }}>
              {grades.map((grade, i) => {
                const own = state.coins.find(
                  (c) =>
                    c.store === store.id &&
                    c.family === family &&
                    c.grade === grade,
                );
                return (
                  <Pressable
                    key={grade}
                    accessibilityRole="button"
                    onPress={() => {
                      if (!own) return toast("아직 보유하지 않은 등급이에요.");
                      choose({ coin: own.id });
                      go(
                        own.nft === "minted"
                          ? "12-2"
                          : own.nft === "pending"
                            ? "12-1"
                            : "10-2",
                      );
                    }}
                    style={{
                      width: "47%",
                      padding: 14,
                      borderRadius: 14,
                      backgroundColor: own ? "#f0faf6" : "#f6f6f3",
                      gap: 8,
                    }}
                  >
                    <Art
                      name={["bronze", "silver", "gold", "prism"][i]!}
                      style={{ opacity: own ? 1 : 0.35 }}
                    />
                    <Txt center bold>
                      {grade}
                    </Txt>
                    <Txt center size={11} muted>
                      {own ? "보유" : "미보유"}
                    </Txt>
                  </Pressable>
                );
              })}
            </Row>
          </Card>
        ))}
        <Go label="가게 정보" to="07-2" kind="outline" />
      </>
    );
  if (!coin)
    return (
      <>
        <Title>코인 상세</Title>
        <Notice>보유한 코인이 없어요.</Notice>
        <Go label="뽑기권 보기" to="09-0" />
      </>
    );
  return (
    <>
      <Title>{coin.family}</Title>
      <Txt center muted>
        {stores.find((s) => s.id === coin.store)?.name} › {coin.grade}
      </Txt>
      <Art
        name={
          ["bronze", "silver", "gold", "prism"][grades.indexOf(coin.grade)]!
        }
        width={230}
        style={{ alignSelf: "center", marginVertical: 20 }}
      />
      <Txt center bold size={24}>
        {coin.family} ({coin.grade})
      </Txt>
      <CoinRow
        store={coin.store}
        family={coin.family}
        selected={coin.grade}
        onSelect={(g) => {
          const other = state.coins.find(
            (c) => c.store === coin.store && c.family === coin.family && c.grade === g,
          );
          if (other) choose({ coin: other.id });
          else toast("아직 보유하지 않은 등급이에요.");
        }}
      />
      <Row>
        <Btn
          label="대표로 설정"
          kind="soft"
          style={{ flex: 1 }}
          onPress={() => {
            update((s) => ({ ...s, representative: coin.id }));
            toast("대표 코인으로 설정했어요.");
          }}
        />
        <Go label="마이룸 전시" to="04-0" kind="outline" style={{ flex: 1 }} />
      </Row>
      <Row>
        <Btn
          label="리롤권 사용"
          kind="outline"
          disabled={coin.nft !== "none"}
          style={{ flex: 1 }}
          onPress={() => {
            choose({ coin: coin.id });
            go("11-1");
          }}
        />
        <Btn
          label={
            coin.nft === "none"
              ? "NFT 받기"
              : coin.nft === "pending"
                ? "NFT 발급 중"
                : "NFT 보기"
          }
          kind="outline"
          style={{ flex: 1 }}
          onPress={() => {
            choose({ coin: coin.id });
            go(
              coin.nft === "none"
                ? "12-0"
                : coin.nft === "pending"
                  ? "12-1"
                  : "12-2",
            );
          }}
        />
      </Row>
      {coin.nft !== "none" ? (
        <Notice>NFT 발급 중이거나 받은 코인은 회수·리롤할 수 없어요.</Notice>
      ) : (
        <Txt muted size={12}>
          리롤은 기존 코인을 회수하고 새로운 코인을 지급해요.
        </Txt>
      )}
    </>
  );
}
function Reroll({ panel }: { panel: number }) {
  const { state, selection, choose, go, update, toast } = usePreview();
  const [sort, setSort] = useState(Number(state.settings.collectionSort ?? 0));
  const [filter, setFilter] = useState(
    Number(state.settings.collectionFilter ?? 0),
  );
  const [grade, setGrade] = useState(
    Number(state.settings.collectionGrade ?? 0),
  );
  const [ticket, setTicket] = useState(0);
  const coin = state.coins.find((c) => c.id === selection.coin);
  const unavailable = rerollUnavailable(state, selection.coin, ticket);
  if (panel === 0)
    return (
      <>
        <Title>정렬 · 필터</Title>
        <Card>
          <Txt bold>정렬 기준</Txt>
          {["최근 획득순", "완성에 가까운 순", "가게 이름순"].map((s, i) => (
            <Btn
              key={s}
              label={`${sort === i ? "✓ " : ""}${s}`}
              kind={sort === i ? "soft" : "outline"}
              onPress={() => setSort(i)}
            />
          ))}
          <Txt bold>수집 상태</Txt>
          <Choices
            labels={["전체", "수집 중", "완성", "미방문"]}
            value={filter}
            onChange={setFilter}
          />
          <Txt bold>등급 필터</Txt>
          <Choices
            labels={["전체", ...grades]}
            value={grade}
            onChange={setGrade}
          />
        </Card>
        <Row>
          <Btn
            label="초기화"
            kind="outline"
            style={{ flex: 1 }}
            onPress={() => {
              setSort(0);
              setFilter(0);
              setGrade(0);
            }}
          />
          <Btn
            label="적용"
            style={{ flex: 2 }}
            onPress={() => {
              update((s) => ({
                ...s,
                settings: {
                  ...s.settings,
                  collectionSort: sort,
                  collectionFilter: filter,
                  collectionGrade: grade,
                },
              }));
              toast("정렬·필터를 저장했어요.");
              go("10-0");
            }}
          />
        </Row>
      </>
    );
  if (panel === 2) {
    const result = state.lastResult;
    return (
      <>
        <Title>리롤 결과</Title>
        <Art name="goodCat" style={{ maxWidth: 240, alignSelf: "center" }} />
        <Txt bold center size={20}>
          새로운 코인을 획득했어요!
        </Txt>
        {result?.before && result.coin ? (
          <>
            <Card>
              <Row>
                {[result.before, result.coin].map((c, i) => (
                  <View key={c.id} style={{ flex: 1, gap: 10 }}>
                    <Txt center size={12}>
                      {i ? "새로 획득한 코인" : "이전 코인 · 회수됨"}
                    </Txt>
                    <Art
                      name={
                        ["bronze", "silver", "gold", "prism"][
                          grades.indexOf(c.grade)
                        ]!
                      }
                    />
                    <Txt center bold>
                      {c.family}
                    </Txt>
                    <Txt center tint={color.green}>
                      {c.grade}
                    </Txt>
                  </View>
                ))}
              </Row>
            </Card>
            <Btn
              label="도감에서 보기"
              onPress={() => {
                choose({ coin: result.coin!.id, store: result.coin!.store });
                go("10-2");
              }}
            />
          </>
        ) : (
          <Notice>
            리롤을 사용하면 회수한 코인과 새 코인을 여기에서 확인해요.
          </Notice>
        )}
        <Go label="홈으로" to="00-0" kind="outline" />
      </>
    );
  }
  if (!coin)
    return (
      <>
        <Title>리롤권 선택</Title>
        <Notice>리롤할 코인이 없어요.</Notice>
        <Go label="도감으로" to="10-0" />
      </>
    );
  return (
    <>
      <Title>리롤권 선택</Title>
      <Card>
        <Row>
          <Art
            name={
              ["bronze", "silver", "gold", "prism"][grades.indexOf(coin.grade)]!
            }
            width={62}
          />
          <View>
            <Txt muted>현재 코인</Txt>
            <Txt bold>
              {coin.family} · {coin.grade}
            </Txt>
          </View>
        </Row>
      </Card>
      <Txt bold>사용할 리롤권을 선택하세요</Txt>
      {["일반 리롤권", "브론즈 리롤권", "실버 리롤권"].map((label, i) => (
        <Pressable
          key={label}
          accessibilityRole="button"
          accessibilityState={{ selected: ticket === i, disabled: !state.rerolls[i] }}
          disabled={!state.rerolls[i]}
          onPress={() => setTicket(i)}
        >
          <Card
            style={{
              borderColor: ticket === i ? color.green : color.line,
              backgroundColor: ticket === i ? "#effaf5" : "#fff",
            }}
          >
            <Row>
              <Icon name={ticket === i ? "check" : "gift"} tint={color.green} />
              <View style={{ flex: 1 }}>
                <Txt bold>{label}</Txt>
                <Txt muted size={11}>
                  {["전체 등급", "브론즈 이상", "실버 이상"][i]}
                </Txt>
              </View>
              <Txt bold>{state.rerolls[i]}장</Txt>
            </Row>
          </Card>
        </Pressable>
      ))}
      <Card>
        <Txt bold>가게 풀 · 가능한 결과</Txt>
        <CoinRow store={coin.store} all />
        {ticket === 2 ? (
          <Txt muted size={11}>
            실버 · 골드 · 프리즘 중 남아 있는 코인에서 뽑아요.
          </Txt>
        ) : null}
      </Card>
      <Notice danger>
        현재 코인은 회수돼요. 선택한 리롤권 1장과 함께 소모하고 가게 풀에서 새
        코인을 지급해요.
      </Notice>
      <Btn
        label="회수하고 다시 뽑기"
        disabled={!!unavailable}
        onPress={() => {
          if (update((s) => rerollCoin(s, coin.id, ticket))) go("11-2");
        }}
      />
      {unavailable ? <Notice>{unavailable}</Notice> : null}
      <Notice>결과·수량은 로컬 테스트 예시이며 운영 확률을 뜻하지 않아요.</Notice>
    </>
  );
}
function Nft({ panel }: { panel: number }) {
  const { state, selection, update, go, toast } = usePreview();
  const coin = state.coins.find((c) => c.id === selection.coin);
  if (!coin)
    return (
      <>
        <Title>NFT 받기</Title>
        <Notice>도감에서 보유 코인을 먼저 선택해 주세요.</Notice>
        <Go label="도감으로" to="10-0" />
      </>
    );
  if (panel === 0)
    return (
      <>
        <Title>NFT로 받을까요?</Title>
        <Art
          name={
            ["bronze", "silver", "gold", "prism"][grades.indexOf(coin.grade)]!
          }
          width={210}
          style={{ alignSelf: "center" }}
        />
        <Txt bold center>
          {coin.family} · {coin.grade}
        </Txt>
        <Notice danger>
          NFT로 받으면 이 코인은 회수하거나 리롤할 수 없어요.
        </Notice>
        <Card>
          <Row style={{ justifyContent: "space-between" }}>
            <Txt bold>받을 지갑</Txt>
            <Txt tint={color.green}>
              {state.wallet ? "테스트 지갑 연결됨" : "연결되지 않음"}
            </Txt>
          </Row>
          {!state.wallet ? (
            <Go label="테스트 지갑 연결" to="22-0" kind="soft" />
          ) : null}
        </Card>
        <Notice>
          로컬 상태로 발급 절차만 체험해요. 블록체인 발행·서명은 실행하지
          않습니다.
        </Notice>
        <Row>
          <Go label="취소" to="10-2" kind="outline" style={{ flex: 1 }} />
          <Btn
            label="확인하고 NFT 받기"
            style={{ flex: 2 }}
            disabled={!state.wallet || coin.nft !== "none"}
            onPress={() => {
              if (update((s) => requestNft(s, coin.id))) go("12-1");
            }}
          />
        </Row>
      </>
    );
  if (panel === 1)
    return (
      <>
        <Title>NFT 발급 중</Title>
        <Art
          name="nftCoin"
          width={220}
          style={{ alignSelf: "center", marginVertical: 35 }}
        />
        <Txt center bold>
          {coin.family} · {coin.grade}
        </Txt>
        <Choices
          labels={["요청 완료", "발급 중", "발급 완료"]}
          value={coin.nft === "minted" ? 2 : 1}
          onChange={() => {}}
        />
        <Notice>발급 중에는 리롤할 수 없어요.</Notice>
        <Btn label="리롤권 사용" disabled kind="outline" onPress={() => {}} />
        <Btn
          label="테스트 발급 상태 확인"
          onPress={() => {
            if (coin.nft === "minted") {
              go("12-2");
              return;
            }
            if (update((s) => finishNft(s, coin.id))) go("12-2");
          }}
        />
        <Go label="도감으로" to="10-0" kind="outline" />
      </>
    );
  return (
    <>
      <Title>NFT 보유 코인</Title>
      <Art name="nftCoin" width={240} style={{ alignSelf: "center" }} />
      <Txt bold center size={23}>
        {coin.family}
      </Txt>
      <Txt center muted>
        {coin.grade} ·{" "}
        {coin.nft === "minted" ? "NFT 보유" : "아직 발급되지 않았어요"}
      </Txt>
      <Row>
        <Btn
          label="NFT 보기"
          kind="outline"
          style={{ flex: 1 }}
          onPress={() => toast("로컬 테스트 NFT예요. 실제 토큰 주소는 없어요.")}
        />
        <Go label="마이룸 전시" to="04-0" kind="outline" style={{ flex: 1 }} />
      </Row>
      <Btn
        label="리롤권 사용"
        disabled
        kind="outline"
        icon="lock"
        onPress={() => {}}
      />
      <Notice>NFT로 받은 코인은 회수·리롤할 수 없어요.</Notice>
      <Go label="도감으로" to="10-0" />
    </>
  );
}
function Shop({ panel }: { panel: number }) {
  const { state, selection, choose, go, update } = usePreview();
  const [category, setCategory] = useState(0);
  const [tone, setTone] = useState(0);
  const item = furniture.find((f) => f.id === selection.item) ?? furniture[0];
  const owned = state.ownedFurniture.includes(item.id);
  if (panel === 0)
    return (
      <>
        <Title back={false}>마일리지 상점</Title>
        <Choices
          labels={["추천", "가구", "꾸미기", "바 테마"]}
          value={category}
          onChange={setCategory}
        />
        {category === 3 ? (
          <>
            <Card>
              <Txt bold>나만의 하단 바</Txt>
              <Art name="room" />
              <Go label="테마 고르기" to="04-2" />
            </Card>
          </>
        ) : (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
            {furniture.map((f) => (
              <Pressable
                key={f.id}
                accessibilityRole="button"
                onPress={() => {
                  choose({ item: f.id });
                  go("13-1");
                }}
                style={{
                  width: "48%",
                  padding: 12,
                  borderRadius: 18,
                  backgroundColor: "#fff",
                  borderWidth: 1,
                  borderColor: color.line,
                  gap: 10,
                }}
              >
                <Art name={f.art} style={{ height: 105 }} />
                <Txt bold size={13}>
                  {f.name}
                </Txt>
                {state.ownedFurniture.includes(f.id) ? (
                  <Txt tint={color.green} size={12}>
                    보유 중
                  </Txt>
                ) : (
                  <Price amount={f.price} />
                )}
              </Pressable>
            ))}
          </View>
        )}
        <ListLink label="구매 내역" to="14-1" />
      </>
    );
  if (panel === 1)
    return (
      <>
        <Title>상품 상세</Title>
        <Art name={item.art} style={{ maxHeight: 250, borderRadius: 18 }} />
        <Txt bold size={24}>
          {item.name}
        </Txt>
        <Price amount={item.price} />
        <Txt muted>내 방에 작은 온기를 더해보세요.</Txt>
        <Go label="마이룸 미리보기" to="03-0" kind="outline" />
        <Txt bold>색상 선택</Txt>
        <Choices
          labels={["민트", "베이지", "핑크", "블루"]}
          value={tone}
          onChange={setTone}
        />
        <Go
          label={owned ? "보유한 가구" : "구매하기"}
          to={owned ? "14-2" : "13-2"}
          kind={owned ? "outline" : "primary"}
        />
      </>
    );
  return (
    <>
      <Title>구매 확인</Title>
      <Card>
        <Art name={item.art} style={{ maxHeight: 180 }} />
        <Txt bold center size={20}>
          {item.name}
        </Txt>
        {[
          ["사용", item.price],
          ["보유", state.points],
          ["구매 후", state.points - item.price],
        ].map(([label, value]) => (
          <Row key={String(label)} style={{ justifyContent: "space-between" }}>
            <Txt>{label}</Txt>
            <Txt bold>{Number(value).toLocaleString()} P</Txt>
          </Row>
        ))}
      </Card>
      <Row>
        <Go label="취소" to="13-1" kind="outline" style={{ flex: 1 }} />
        <Btn
          label={`${item.price} P로 구매`}
          style={{ flex: 2 }}
          disabled={owned || state.points < item.price}
          onPress={() => {
            if (update((s) => buyFurniture(s, item.id))) go("14-0");
          }}
        />
      </Row>
      {state.points < item.price ? (
        <Notice>
          마일리지가 부족해요. 놀이에서 테스트 보상을 받을 수 있어요.
        </Notice>
      ) : null}
    </>
  );
}
function Inventory({ panel }: { panel: number }) {
  const { state, selection, choose, go, draft, setDraft } = usePreview();
  const [tab, setTab] = useState(0);
  const [ledgerFilter, setLedgerFilter] = useState(0);
  const item =
    furniture.find((f) => f.id === (state.lastPurchased ?? selection.item)) ??
    furniture[0];
  if (panel === 0)
    return (
      <>
        <Title>구매 완료</Title>
        <Art name={item.art} style={{ maxHeight: 260 }} />
        <Txt bold center size={26}>
          {item.name}
        </Txt>
        <Txt center muted>
          구매가 완료되었어요!
        </Txt>
        <Card>
          <Row style={{ justifyContent: "space-between" }}>
            <Txt>남은 마일리지</Txt>
            <Price amount={state.points} />
          </Row>
        </Card>
        <Btn
          label="마이룸에 배치"
          icon="home"
          onPress={() => {
            setDraft({ ...draft, furniture: item.id });
            go("03-1");
          }}
        />
        <Row>
          <Go label="보관함" to="14-2" kind="outline" style={{ flex: 1 }} />
          <Go label="상점으로" to="13-0" kind="outline" style={{ flex: 1 }} />
        </Row>
      </>
    );
  if (panel === 1)
    return (
      <>
        <Title>마일리지 내역</Title>
        <Card>
          <Txt bold>보유 마일리지</Txt>
          <Price amount={state.points} />
        </Card>
        <Choices
          labels={["전체", "적립", "사용"]}
          value={ledgerFilter}
          onChange={setLedgerFilter}
        />
        {state.ledger
          .filter(
            (l) =>
              ledgerFilter === 0 ||
              (ledgerFilter === 1 ? l.amount > 0 : l.amount < 0),
          )
          .map((l, i) => (
            <Card key={i}>
              <Row style={{ justifyContent: "space-between" }}>
                <Txt>{l.label}</Txt>
                <Txt tint={l.amount > 0 ? color.green : color.red} bold>
                  {l.amount > 0 ? "+" : ""}
                  {l.amount.toLocaleString()} P
                </Txt>
              </Row>
            </Card>
          ))}
      </>
    );
  return (
    <>
      <Title>보관함</Title>
      <Choices
        labels={["가구", "동행", "리롤권", "뽑기권"]}
        value={tab}
        onChange={setTab}
      />
      {tab === 0 ? (
        <>
          <Txt bold>보유 가구 {state.ownedFurniture.length}개</Txt>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
            {furniture
              .filter((f) => state.ownedFurniture.includes(f.id))
              .map((f) => (
                <Pressable
                  key={f.id}
                  accessibilityRole="button"
                  onPress={() => {
                    choose({ item: f.id });
                    setDraft({ ...draft, furniture: f.id });
                    go("03-1");
                  }}
                  style={{
                    width: "47%",
                    backgroundColor: "#fff",
                    padding: 14,
                    borderRadius: 15,
                    borderWidth: 1,
                    borderColor: color.line,
                    gap: 8,
                  }}
                >
                  <Art name={f.art} style={{ height: 115 }} />
                  <Txt size={12} center>
                    {f.name}
                  </Txt>
                </Pressable>
              ))}
          </View>
          <Go label="마이룸에 배치" to="03-1" />
        </>
      ) : tab === 1 ? (
        <>
          <Art name="cat" />
          <Go label="동행 꾸미기" to="04-1" />
        </>
      ) : tab === 2 ? (
        <>
          {["일반", "브론즈", "실버"].map((name, i) => (
            <Card key={name}>
              <Txt bold>
                {name} 리롤권 · {state.rerolls[i]}장
              </Txt>
            </Card>
          ))}
          <Go label="도감에서 코인 선택" to="10-0" />
        </>
      ) : (
        <>
          {stores.map((s) => (
            <Btn
              key={s.id}
              label={`${s.name} · ${state.tickets[s.id]}장`}
              kind="outline"
              onPress={() => {
                choose({ store: s.id });
                go("09-0");
              }}
            />
          ))}
        </>
      )}
    </>
  );
}
export function CommerceScreens({
  board,
  panel,
}: {
  board: number;
  panel: number;
}) {
  switch (board) {
    case 7:
      return <Explore panel={panel} />;
    case 8:
      return <Visit panel={panel} />;
    case 9:
      return <Draw panel={panel} />;
    case 10:
      return <Collection panel={panel} />;
    case 11:
      return <Reroll panel={panel} />;
    case 12:
      return <Nft panel={panel} />;
    case 13:
      return <Shop panel={panel} />;
    case 14:
      return <Inventory panel={panel} />;
    default:
      return null;
  }
}
