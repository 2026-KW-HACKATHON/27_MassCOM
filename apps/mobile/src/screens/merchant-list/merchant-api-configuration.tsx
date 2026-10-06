import { Text, View } from 'react-native';
export function MerchantApiConfigurationRequired() {
  return <View style={{padding:24,gap:12}}><Text accessibilityRole="header" style={{fontSize:24,fontWeight:'700'}}>음식점 API 주소가 연결되지 않았습니다.</Text><Text>EXPO_PUBLIC_API_URL을 설정해 주세요.</Text></View>;
}
