import { useState } from "react";
import { Pressable, View } from "react-native";
import { Art } from "./art";
import {
  Avatar,
  Btn,
  Card,
  Choices,
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
import { claimMail, stores } from "./model";
import { RoomScene } from "./social-screens";

function Profile({ panel }: { panel: number }) {
  const { state, update, go, toast } = usePreview();
  const [intro, setIntro] = useState(state.intro);
  const [name, setName] = useState(state.nickname);
  const [editing, setEditing] = useState(false);
  if (panel === 0)
    return (
      <>
        <Title>내 프로필</Title>
        <Art
          name={state.room.accessory ? "scarfCat" : "cat"}
          style={{ maxHeight: 210 }}
        />
        {editing ? (
          <>
            <Field
              label="닉네임"
              value={name}
              onChange={setName}
              maxLength={16}
            />
            <Btn
              label="닉네임 저장"
              kind="soft"
              onPress={() => {
                if (!name.trim()) return toast("닉네임을 입력해 주세요.");
                update((s) => ({ ...s, nickname: name.trim() }));
                setEditing(false);
              }}
            />
          </>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="닉네임 편집"
            onPress={() => setEditing(true)}
          >
            <Txt center bold size={25}>
              {state.nickname} ✎
            </Txt>
          </Pressable>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="한 줄 소개 편집"
          onPress={() => go("18-1")}
        >
          <Txt center muted>
            {state.intro} ✎
          </Txt>
        </Pressable>
        <Row>
          {[
            ["코인", state.coins.length],
            ["친구", state.friends.length],
            ["가구", state.ownedFurniture.length],
          ].map(([title, count]) => (
            <Card key={String(title)} style={{ flex: 1, alignItems: "center" }}>
              <Txt size={12}>{title}</Txt>
              <Txt bold size={23}>
                {count}
              </Txt>
            </Card>
          ))}
        </Row>
        <Card>
          <Txt bold>내 방 미리보기</Txt>
          <RoomScene />
          <Go label="마이룸으로" to="03-0" kind="soft" />
        </Card>
        <Row>
          <Go label="동행 선택" to="04-1" kind="outline" style={{ flex: 1 }} />
          <Go label="탐험 여권" to="18-2" kind="outline" style={{ flex: 1 }} />
        </Row>
      </>
    );
  if (panel === 1)
    return (
      <>
        <Title>한 줄 소개 편집</Title>
        <Card>
          <Txt bold>미리보기</Txt>
          <Row>
            <Avatar />
            <View>
              <Txt bold size={20}>
                {state.nickname}
              </Txt>
              <Txt muted>{intro || "한 줄 소개를 입력하세요"} ✎</Txt>
            </View>
          </Row>
        </Card>
        <Field
          label="한 줄 소개"
          value={intro}
          onChange={setIntro}
          maxLength={30}
        />
        <Txt muted size={12}>
          {intro.length} / 30 · 프로필 오른쪽에 표시돼요.
        </Txt>
        <View style={{ minHeight: 170 }} />
        <Row>
          <Go label="취소" to="18-0" kind="outline" style={{ flex: 1 }} />
          <Btn
            label="저장"
            style={{ flex: 2 }}
            onPress={() => {
              update((s) => ({ ...s, intro: intro.trim() }));
              toast("한 줄 소개를 저장했어요.");
              go("18-0");
            }}
          />
        </Row>
      </>
    );
  return (
    <>
      <Title>탐험 여권</Title>
      <Art name="passport" width={170} style={{ alignSelf: "center" }} />
      <Txt center muted>
        좋은 가게를 발견하며 나만의 지도를 채워요.
      </Txt>
      <Row>
        {["카페 마스터", "맛집 탐험가", "베이커리 러버"].map((name, i) => (
          <Card key={name} style={{ flex: 1, padding: 10 }}>
            <Icon
              name={["map", "star", "bag"][i]!}
              size={35}
              tint={color.gold}
            />
            <Txt size={11} bold>
              {name}
            </Txt>
            <Txt bold>Lv.{3 - i}</Txt>
          </Card>
        ))}
      </Row>
      <Card>
        <Txt bold>가게 스탬프</Txt>
        {stores.map((s) => (
          <Row key={s.id} style={{ justifyContent: "space-between" }}>
            <Txt>{s.name}</Txt>
            <Txt tint={color.green}>{state.visits[s.id]}회 방문</Txt>
          </Row>
        ))}
      </Card>
      <Go label="대표 코인 설정" to="10-0" kind="outline" />
      <Go label="친구에게 공유" to="02-1" kind="outline" />
    </>
  );
}
function MailAndMissions({ panel }: { panel: number }) {
  const { state, selection, choose, update, go, toast } = usePreview();
  const [tab, setTab] = useState(0);
  const mail = state.mail.find((m) => m.id === selection.mail) ?? state.mail[0];
  if (panel === 0)
    return (
      <>
        <Title>우편함</Title>
        <Choices
          labels={["전체", "우정", "보상", "소식"]}
          value={tab}
          onChange={setTab}
        />
        <Btn
          label="모두 읽음"
          kind="outline"
          small
          onPress={() =>
            update((s) => ({
              ...s,
              mail: s.mail.map((m) => ({ ...m, read: true })),
            }))
          }
        />
        {state.mail
          .filter(
            (m) =>
              tab === 0 ||
              (tab === 1 && m.title.includes("우정")) ||
              (tab === 2 && m.reward > 0) ||
              (tab === 3 && m.reward === 0),
          )
          .map((m) => (
            <Pressable
              key={m.id}
              accessibilityRole="button"
              accessibilityLabel={m.title}
              onPress={() => {
                choose({ mail: m.id });
                update((s) => ({
                  ...s,
                  mail: s.mail.map((x) =>
                    x.id === m.id ? { ...x, read: true } : x,
                  ),
                }));
                go("19-1");
              }}
            >
              <Card>
                <Row>
                  <Icon
                    name={m.reward ? "gift" : "mail"}
                    size={33}
                    tint={m.read ? color.muted : color.green}
                  />
                  <View style={{ flex: 1 }}>
                    <Txt bold>{m.title}</Txt>
                    <Txt size={11} muted>
                      {m.from} ·{" "}
                      {m.claimed ? "받기 완료" : m.read ? "읽음" : "새 우편"}
                    </Txt>
                  </View>
                  {m.reward > 0 ? (
                    <Txt tint={color.gold}>+{m.reward} P</Txt>
                  ) : null}
                </Row>
              </Card>
            </Pressable>
          ))}
        <Btn
          label="보상 모두 받기"
          onPress={() => {
            let any = false;
            update((s) => {
              let next = s;
              for (const m of s.mail) {
                if (m.reward > 0 && !m.claimed) {
                  next = claimMail(next, m.id);
                  any = true;
                }
              }
              return next;
            });
            toast(any ? "우편 보상을 받았어요." : "받을 보상이 없어요.");
          }}
        />
      </>
    );
  if (panel === 1)
    return (
      <>
        <Title>우편 상세</Title>
        {mail ? (
          <>
            <Row>
              <Avatar name="sora" />
              <View>
                <Txt bold>{mail.from}</Txt>
                <Txt muted size={12}>
                  {mail.title}
                </Txt>
              </View>
            </Row>
            <Card>
              <Txt>{mail.message}</Txt>
            </Card>
            <Art
              name="heartGift"
              style={{ maxWidth: 265, alignSelf: "center" }}
            />
            {mail.reward > 0 ? (
              <Btn
                label={mail.claimed ? "받기 완료" : `${mail.reward} P 받기`}
                disabled={mail.claimed}
                onPress={() => {
                  if (update((s) => claimMail(s, mail.id)))
                    toast("보상을 받았어요.");
                }}
              />
            ) : null}
            <Row>
              <Btn
                label="답장"
                disabled={!state.friends.includes(mail.from)}
                onPress={() => {
                  choose({ friend: mail.from });
                  go("02-1");
                }}
                kind="outline"
                style={{ flex: 1 }}
              />
              <Btn
                label="친구 마이룸"
                disabled={!state.friends.includes(mail.from)}
                onPress={() => {
                  choose({ friend: mail.from });
                  go("05-2");
                }}
                kind="outline"
                style={{ flex: 1 }}
              />
            </Row>
          </>
        ) : (
          <Notice>우편이 없어요.</Notice>
        )}
      </>
    );
  const total = Object.values(state.visits).reduce((a, b) => a + b, 0);
  const missionClaimed = state.claimed.includes("coin-mission");
  return (
    <>
      <Title>미션</Title>
      <Choices
        labels={["오늘", "방문", "수집", "놀이"]}
        value={tab}
        onChange={setTab}
      />
      {[
        {
          name: "가게 방문하기",
          progress: Math.min(total, 3),
          goal: 3,
          to: "07-0" as const,
        },
        {
          name: "놀이 완주하기",
          progress: Math.min(
            state.claimed.filter((k) => k.startsWith("game-")).length,
            3,
          ),
          goal: 3,
          to: "15-0" as const,
        },
      ].map((m) => (
        <Card key={m.name}>
          <Txt bold size={17}>
            {m.name}
          </Txt>
          <Txt muted>
            {m.progress} / {m.goal}
          </Txt>
          <Go label="하러 가기" to={m.to} kind="outline" />
        </Card>
      ))}
      <Card>
        <Txt bold size={17}>
          새 코인 획득하기
        </Txt>
        <Txt muted>{state.coins.length ? "1" : "0"} / 1</Txt>
        <Btn
          label={missionClaimed ? "받기 완료" : "보상 받기 · 20 P"}
          disabled={missionClaimed || !state.coins.length}
          onPress={() => {
            update((s) =>
              s.claimed.includes("coin-mission")
                ? s
                : {
                    ...s,
                    points: s.points + 20,
                    claimed: [...s.claimed, "coin-mission"],
                    ledger: [
                      { label: "로컬 수집 미션", amount: 20 },
                      ...s.ledger,
                    ],
                  },
            );
            toast("미션 보상을 받았어요.");
          }}
        />
      </Card>
    </>
  );
}
function Volume({ label, setting }: { label: string; setting: string }) {
  const { state, update } = usePreview();
  const value = Number(state.settings[setting] ?? 70);
  return (
    <Row>
      <Btn
        label="−"
        small
        kind="outline"
        onPress={() =>
          update((s) => ({
            ...s,
            settings: { ...s.settings, [setting]: Math.max(0, value - 10) },
          }))
        }
      />
      <View style={{ flex: 1, gap: 5 }}>
        <Txt muted size={11}>
          {label} {value}%
        </Txt>
        <View
          style={{ height: 7, borderRadius: 6, backgroundColor: "#e7ecec" }}
        >
          <View
            style={{
              width: `${value}%`,
              height: 7,
              borderRadius: 6,
              backgroundColor: color.green,
            }}
          />
        </View>
      </View>
      <Btn
        label="+"
        small
        kind="outline"
        onPress={() =>
          update((s) => ({
            ...s,
            settings: { ...s.settings, [setting]: Math.min(100, value + 10) },
          }))
        }
      />
    </Row>
  );
}
function Settings({ panel }: { panel: number }) {
  const { state, update, go, toast } = usePreview();
  const formatTime = (value: boolean | number | undefined, fallback: number) =>
    String(typeof value === "number" ? value : fallback)
      .padStart(4, "0")
      .replace(/(..)(..)$/, "$1:$2");
  const [from, setFrom] = useState(formatTime(state.settings.quietFrom, 2200));
  const [to, setTo] = useState(formatTime(state.settings.quietTo, 700));
  const toggle = (key: string, label: string) => (
    <Toggle
      key={key}
      label={label}
      value={state.settings[key] !== false}
      onChange={(v) =>
        update((s) => ({ ...s, settings: { ...s.settings, [key]: v } }))
      }
    />
  );
  if (panel === 0)
    return (
      <>
        <Title back={false}>설정</Title>
        <ListLink label="소리와 움직임" to="20-1" />
        <ListLink label="알림 설정" to="20-2" />
        <ListLink label="마이룸 공개" to="05-0" icon="home" />
        <ListLink label="하단 바 꾸미기" to="04-2" icon="brush" />
        <ListLink label="계정·지갑" to="22-0" />
        <ListLink label="도움말" to="22-1" />
        <ListLink label="약관·개인정보" to="21-1" />
        <Btn
          label="로그아웃 화면 보기"
          kind="outline"
          onPress={() => go("21-0")}
        />
        <Go label="로컬 데이터 초기화" to="22-2" kind="outline" />
      </>
    );
  if (panel === 1)
    return (
      <>
        <Title>소리와 움직임</Title>
        <Card>
          {toggle("music", "배경음")}
          <Volume label="배경음 크기" setting="musicVolume" />
        </Card>
        <Card>
          {toggle("effects", "효과음")}
          <Volume label="효과음 크기" setting="effectsVolume" />
        </Card>
        <Card>
          {toggle("vibration", "진동")}
          {toggle("reducedMotion", "움직임 줄이기")}
          <Notice>
            이 로컬 버전에서는 설정 저장과 화면 움직임을 확인해요. 기기
            소리·진동 재생은 연결하지 않았어요.
          </Notice>
        </Card>
        <Btn
          label="기본값으로"
          kind="outline"
          onPress={() => {
            update((s) => ({
              ...s,
              settings: {
                ...s.settings,
                music: true,
                effects: true,
                musicVolume: 70,
                effectsVolume: 80,
                vibration: false,
                reducedMotion: false,
              },
            }));
            toast("기본값으로 복원했어요.");
          }}
        />
      </>
    );
  return (
    <>
      <Title>알림 설정</Title>
      <Card>{toggle("notifications", "전체 알림")}</Card>
      <Card>
        {[
          ["mail", "우편 알림"],
          ["friendship", "우정 알림"],
          ["visits", "마이룸 방문 알림"],
          ["invites", "식사 초대 알림"],
          ["rewards", "보상 안내 알림"],
        ].map(([k, l]) => toggle(k!, l!))}
      </Card>
      <Card>
        <Txt bold>방해 금지 시간</Txt>
        <Row>
          <View style={{ flex: 1 }}>
            <Field label="시작" value={from} onChange={setFrom} />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="종료" value={to} onChange={setTo} />
          </View>
        </Row>
      </Card>
      <Btn
        label="저장"
        onPress={() => {
          if (
            !/^([01]\d|2[0-3]):[0-5]\d$/.test(from) ||
            !/^([01]\d|2[0-3]):[0-5]\d$/.test(to)
          )
            return toast("시간을 HH:MM 형식으로 입력해 주세요.");
          update((s) => ({
            ...s,
            settings: {
              ...s.settings,
              quietFrom: Number(from.replace(":", "")),
              quietTo: Number(to.replace(":", "")),
            },
          }));
          toast("알림 설정을 저장했어요. 실제 푸시는 전송하지 않아요.");
        }}
      />
    </>
  );
}
function Onboarding({ panel }: { panel: number }) {
  const { state, update, toast } = usePreview();
  const [detail, setDetail] = useState(false);
  if (panel === 0)
    return (
      <>
        <View style={{ paddingTop: 28, gap: 12 }}>
          <Txt center bold size={33}>
            우리 동네를 모으다
          </Txt>
          <Txt center muted>
            골목마다 숨은 가게,{`\n`}특별한 경험이 기다려요.
          </Txt>
        </View>
        <RoomScene />
        <Go label="로컬 테스트로 시작" to="21-1" />
        <Go label="가게 먼저 둘러보기" to="07-0" kind="outline" />
        <Notice>
          Google 로그인·계정 생성 없이 테스트 데이터를 사용합니다.
        </Notice>
      </>
    );
  if (panel === 1)
    return (
      <>
        <Title>이용 동의</Title>
        <Txt center muted>
          서비스 이용 안내 화면을 확인해 보세요.
        </Txt>
        <View style={{ minHeight: 25 }} />
        <Card>
          {[
            "[필수] 서비스 이용약관",
            "[필수] 개인정보 처리방침",
            "[선택] 소식 받기",
          ].map((label, i) => (
            <Toggle
              key={label}
              label={label}
              value={state.terms[i] ?? false}
              onChange={(v) =>
                update((s) => {
                  const terms = [...s.terms] as typeof s.terms;
                  terms[i] = v;
                  return { ...s, terms };
                })
              }
            />
          ))}
          <Btn
            label="자세히 보기"
            kind="outline"
            small
            onPress={() => setDetail(!detail)}
          />
          {detail ? (
            <Notice>
              UI 동의 화면의 예시입니다. 로컬 저장소 외에 데이터를 전송하지
              않으며 실제 약관 동의 이력은 만들지 않습니다.
            </Notice>
          ) : null}
        </Card>
        <View style={{ minHeight: 80 }} />
        <Go
          label="동의하고 계속"
          to="21-2"
          disabled={!state.terms[0] || !state.terms[1]}
        />
      </>
    );
  return (
    <>
      <Title>편리한 탐색을 위해</Title>
      <Card>
        <Icon name="map" size={40} tint={color.green} />
        <Txt bold size={21}>
          내 위치로 가게 찾기
        </Txt>
        <Txt muted>주변 가게를 찾을 때 위치를 사용해요.</Txt>
        <Btn
          label="위치 허용 화면 확인"
          onPress={() =>
            toast("로컬 테스트에서는 위치 권한을 요청하지 않아요.")
          }
        />
        <Go label="동네 직접 선택" to="07-0" kind="soft" />
      </Card>
      <Card>
        <Icon name="scan" size={40} tint={color.green} />
        <Txt bold size={21}>
          방문 QR 인증
        </Txt>
        <Txt muted>가게의 QR 코드로 방문을 인증해요.</Txt>
        <Btn
          label="카메라 허용 화면 확인"
          onPress={() => toast("로컬 테스트에서는 카메라를 켜지 않아요.")}
        />
        <Go label="코드 직접 입력" to="08-1" kind="soft" />
      </Card>
      <Go label="홈으로 시작" to="00-0" />
    </>
  );
}
function AccountHelp({ panel }: { panel: number }) {
  const { state, update, reset, toast } = usePreview();
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(2);
  const [confirm, setConfirm] = useState("");
  if (panel === 0)
    return (
      <>
        <Title>계정·지갑</Title>
        <Card>
          <Txt bold size={19}>
            계정 정보
          </Txt>
          <Row>
            <Avatar />
            <View>
              <Txt bold>{state.nickname} · 로컬 테스트</Txt>
              <Txt muted size={12}>
                실제 계정으로 로그인하지 않았어요.
              </Txt>
            </View>
          </Row>
          <Go label="로그인 화면 보기" to="21-0" kind="outline" />
        </Card>
        <Card>
          <Txt bold size={19}>
            외부 지갑
          </Txt>
          <Txt muted>{state.wallet ? "테스트 연결됨" : "연결되지 않음"}</Txt>
          <Btn
            label={state.wallet ? "테스트 연결 해제" : "테스트 지갑 연결"}
            onPress={() => {
              update((s) => ({ ...s, wallet: !s.wallet }));
              toast(
                state.wallet
                  ? "테스트 연결을 해제했어요."
                  : "테스트 연결 상태를 저장했어요.",
              );
            }}
          />
          <Notice>
            실제 지갑 연결·주소·서명 없이 NFT 화면 상태를 확인합니다.
          </Notice>
          {state.wallet ? (
            <Go label="NFT 받기로 돌아가기" to="12-0" kind="outline" />
          ) : null}
        </Card>
      </>
    );
  if (panel === 1) {
    const questions = [
      "방문 인증이 안 돼요",
      "뽑기권과 리롤권",
      "NFT를 받은 뒤 리롤",
      "마이룸 공개 범위",
    ];
    const answers = [
      "이 테스트 앱에서는 MOON-2026 코드를 입력하세요. 실제 가게 방문을 기록하지 않아요.",
      "뽑기권은 새 코인을 추가해요. 리롤권은 기존 코인을 회수하고 가게 풀에서 다른 코인이나 등급을 뽑아요.",
      "NFT 받기를 완료하면 해당 코인은 회수하거나 리롤할 수 없어요. 발급 진행 중에도 리롤이 잠겨요.",
      "나만 보기, 친구, 같은 가게 이웃 중에서 고를 수 있어요. 랜덤 방문은 공통 방문 가게가 있는 공개 방에만 가능해요.",
    ];
    return (
      <>
        <Title>도움말</Title>
        <Field label="궁금한 내용을 검색" value={query} onChange={setQuery} />
        {questions.map((q, i) =>
          q.includes(query) ? (
            <Pressable
              key={q}
              accessibilityRole="button"
              onPress={() => setExpanded(expanded === i ? -1 : i)}
            >
              <Card
                style={{ backgroundColor: expanded === i ? "#effaf5" : "#fff" }}
              >
                <Txt bold>{q}</Txt>
                {expanded === i ? <Txt muted>{answers[i]}</Txt> : null}
              </Card>
            </Pressable>
          ) : null,
        )}
        <Go label="전체 테스트 화면" to="20-0" kind="outline" />
      </>
    );
  }
  return (
    <>
      <Title>로컬 데이터 초기화</Title>
      <Art name="cat" style={{ maxHeight: 200 }} />
      <Card>
        <Txt bold size={20}>
          테스트 기록을 처음으로
        </Txt>
        <Txt muted>
          이 기기에 저장한 꾸미기·뽑기·구매·놀이 기록을 초기화합니다. 실제
          계정이나 서버 데이터에는 영향이 없어요.
        </Txt>
        <Field
          label="확인하려면 초기화를 입력하세요"
          value={confirm}
          onChange={setConfirm}
        />
      </Card>
      <Btn
        label="테스트 데이터 초기화"
        kind="danger"
        disabled={confirm !== "초기화"}
        onPress={reset}
      />
      <Go label="돌아가기" to="20-0" kind="outline" />
    </>
  );
}
export function AccountScreens({
  board,
  panel,
}: {
  board: number;
  panel: number;
}) {
  switch (board) {
    case 18:
      return <Profile panel={panel} />;
    case 19:
      return <MailAndMissions panel={panel} />;
    case 20:
      return <Settings panel={panel} />;
    case 21:
      return <Onboarding panel={panel} />;
    case 22:
      return <AccountHelp panel={panel} />;
    default:
      return null;
  }
}
