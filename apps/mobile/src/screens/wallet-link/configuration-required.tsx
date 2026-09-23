import { ScrollView, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colorsForScheme } from '@/theme/palette';
import { makeWalletConfigurationRequiredStyles } from './configuration-required.styles';

type Props = {
  missing: string[];
};

export function WalletConfigurationRequired({ missing }: Props) {
  const styles = StyleSheet.create(makeWalletConfigurationRequiredStyles(colorsForScheme(useColorScheme()), StyleSheet.hairlineWidth));
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={[styles.content, { paddingBottom: 24 + insets.bottom }]}
    >
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
