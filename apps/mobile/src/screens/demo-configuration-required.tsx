import { StyleSheet, Text, View } from 'react-native';

import { colors } from '@/theme/colors';

export function DemoConfigurationRequired({
  title,
  missing,
}: {
  title: string;
  missing: readonly string[];
}) {
  return (
    <View style={styles.content}>
      <Text style={styles.eyebrow}>개발·시연 설정 필요</Text>
      <Text selectable style={styles.title}>{title}</Text>
      <Text selectable style={styles.body}>
        아래 값은 운영 인증이 아니라 loopback 개발 서버에서만 쓰는 공개 데모 식별자입니다.
        개인키·복구 문구·지갑 주소를 넣지 않습니다.
      </Text>
      <View style={styles.card}>
        {missing.map((key) => (
          <Text selectable key={key} style={styles.code}>{key}</Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, justifyContent: 'center', gap: 16, padding: 24, backgroundColor: colors.background },
  eyebrow: { color: colors.primary, fontSize: 13, fontWeight: '900' },
  title: { color: colors.label, fontSize: 30, fontWeight: '900', lineHeight: 38 },
  body: { color: colors.secondaryLabel, fontSize: 15, lineHeight: 24 },
  card: { gap: 10, padding: 18, borderRadius: 18, backgroundColor: colors.surface },
  code: { color: colors.primary, fontFamily: 'monospace', fontSize: 13, fontWeight: '700' },
});
