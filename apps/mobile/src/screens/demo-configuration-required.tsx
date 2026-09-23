import { StyleSheet, Text, View, useColorScheme } from 'react-native';

import { colorsForScheme } from '@/theme/palette';
import { makeDemoConfigurationRequiredStyles } from './demo-configuration-required.styles';

export function DemoConfigurationRequired({
  title,
  missing,
}: {
  title: string;
  missing: readonly string[];
}) {
  const styles = StyleSheet.create(makeDemoConfigurationRequiredStyles(colorsForScheme(useColorScheme()), StyleSheet.hairlineWidth));
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
