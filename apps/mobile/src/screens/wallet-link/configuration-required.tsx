import { ScrollView, StyleSheet, Text, View, useColorScheme } from 'react-native';

import { colors } from '@/theme/colors';

type Props = {
  missing: string[];
};

export function WalletConfigurationRequired({ missing }: Props) {
  useColorScheme();

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
      <View style={styles.badge}>
        <Text style={styles.badgeText}>BLOCKED</Text>
      </View>
      <Text selectable style={styles.title}>지갑 연결 설정이{`\n`}필요합니다.</Text>
      <Text selectable style={styles.body}>
        Reown project ID와 로컬 API 주소가 없어서 외부 지갑을 열지 않습니다. 방문 기록과
        받을 수집품은 지갑 설정과 무관하게 유지됩니다.
      </Text>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>비어 있는 환경 변수</Text>
        {missing.map((item) => (
          <Text selectable key={item} style={styles.code}>{item}</Text>
        ))}
      </View>
      <Text selectable style={styles.note}>
        개인키·복구 문구는 어떤 환경 변수에도{`\n`}넣지 않습니다.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    gap: 18,
    padding: 24,
    backgroundColor: colors.background,
  },
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: '#FCE4DA',
  },
  badgeText: {
    color: colors.error,
    fontSize: 12,
    fontWeight: '800',
  },
  title: {
    color: colors.label,
    fontSize: 30,
    fontWeight: '800',
    lineHeight: 38,
  },
  body: {
    color: colors.secondaryLabel,
    fontSize: 17,
    lineHeight: 27,
  },
  card: {
    gap: 10,
    padding: 18,
    borderRadius: 18,
    borderCurve: 'continuous',
    backgroundColor: colors.surface,
    boxShadow: '0 8px 24px rgba(16, 40, 51, 0.08)',
  },
  cardTitle: {
    color: colors.label,
    fontSize: 16,
    fontWeight: '700',
  },
  code: {
    color: colors.primary,
    fontFamily: 'monospace',
    fontSize: 14,
  },
  note: {
    color: colors.secondaryLabel,
    fontSize: 14,
  },
});
