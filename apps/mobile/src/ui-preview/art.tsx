import {
  Image,
  View,
  type ImageSourcePropType,
  type StyleProp,
  type ViewStyle,
} from "react-native";

const sheets: Record<string, ImageSourcePropType> = {
  "00-home": require("../../assets/images/ui-preview/00-home.png"),
  "01-friends": require("../../assets/images/ui-preview/01-friends.png"),
  "03-room-edit": require("../../assets/images/ui-preview/03-room-edit.png"),
  "04-customization": require("../../assets/images/ui-preview/04-customization.png"),
  "05-room-visitors": require("../../assets/images/ui-preview/05-room-visitors.png"),
  "06-store-neighbors": require("../../assets/images/ui-preview/06-store-neighbors.png"),
  "07-explore": require("../../assets/images/ui-preview/07-explore.png"),
  "08-visit": require("../../assets/images/ui-preview/08-visit.png"),
  "09-draw": require("../../assets/images/ui-preview/09-draw.png"),
  "10-collection": require("../../assets/images/ui-preview/10-collection.png"),
  "11-reroll": require("../../assets/images/ui-preview/11-reroll.png"),
  "12-nft": require("../../assets/images/ui-preview/12-nft.png"),
  "13-shop": require("../../assets/images/ui-preview/13-shop.png"),
  "14-inventory": require("../../assets/images/ui-preview/14-inventory.png"),
  "15-play-start": require("../../assets/images/ui-preview/15-play-start.png"),
  "16-play-games": require("../../assets/images/ui-preview/16-play-games.png"),
  "18-profile": require("../../assets/images/ui-preview/18-profile.png"),
  "19-mail-missions": require("../../assets/images/ui-preview/19-mail-missions.png"),
};
const regions: Record<string, [string, number, number, number, number]> = {
  avatar: ["00-home", 64, 39, 112, 112],
  haru: ["01-friends", 61, 369, 77, 77],
  sora: ["01-friends", 62, 534, 74, 74],
  mint: ["01-friends", 62, 708, 75, 75],
  room: ["00-home", 220, 260, 578, 419],
  roomFriend: ["05-room-visitors", 1050, 169, 448, 376],
  roomNeighbor: ["06-store-neighbors", 1044, 246, 459, 434],
  wallRoom: ["03-room-edit", 1040, 172, 458, 342],
  cat: ["18-profile", 59, 169, 408, 253],
  scarfCat: ["04-customization", 560, 184, 435, 323],
  goodCat: ["11-reroll", 1127, 168, 298, 140],
  heartGift: ["19-mail-missions", 615, 389, 329, 195],
  ticket: ["09-draw", 80, 171, 364, 213],
  ticketBread: ["00-home", 42, 794, 208, 159],
  ticketFood: ["00-home", 787, 787, 198, 155],
  bronze: ["09-draw", 558, 463, 78, 80],
  silver: ["09-draw", 648, 463, 78, 80],
  gold: ["09-draw", 738, 463, 78, 80],
  prism: ["09-draw", 825, 463, 78, 80],
  silverBig: ["09-draw", 1109, 190, 318, 273],
  nftCoin: ["12-nft", 1120, 149, 270, 207],
  sofa: ["13-shop", 559, 166, 432, 265],
  lamp: ["15-play-start", 697, 604, 105, 148],
  plant: ["13-shop", 82, 536, 103, 144],
  bed: ["14-inventory", 1203, 369, 132, 111],
  table: ["14-inventory", 1060, 582, 124, 103],
  shelf: ["14-inventory", 1364, 359, 125, 119],
  cafe: ["06-store-neighbors", 48, 226, 194, 206],
  bakery: ["06-store-neighbors", 48, 454, 194, 203],
  foodStore: ["06-store-neighbors", 48, 685, 194, 186],
  cafeWide: ["07-explore", 1028, 137, 442, 199],
  cafeModel: ["10-collection", 552, 173, 169, 158],
  qr: ["01-friends", 578, 519, 119, 126],
  scan: ["08-visit", 545, 167, 450, 612],
  map: ["07-explore", 54, 254, 470, 385],
  display: ["04-customization", 42, 183, 458, 321],
  passport: ["18-profile", 1052, 160, 224, 165],
  neighborCafe: ["06-store-neighbors", 685, 318, 165, 197],
  sky: ["06-store-neighbors", 727, 174, 91, 81],
  rabbit: ["06-store-neighbors", 853, 235, 96, 90],
  dog: ["06-store-neighbors", 853, 432, 100, 89],
  penguin: ["06-store-neighbors", 722, 487, 101, 91],
  mocha: ["06-store-neighbors", 588, 236, 103, 86],
  stack: ["15-play-start", 1028, 195, 476, 540],
  delivery: ["16-play-games", 530, 249, 469, 465],
  order: ["16-play-games", 1035, 262, 466, 217],
  game0: ["15-play-start", 56, 195, 202, 115],
  game1: ["15-play-start", 287, 197, 184, 114],
  game2: ["15-play-start", 54, 450, 202, 119],
  game3: ["15-play-start", 286, 450, 190, 119],
};
export function Art({
  name,
  width,
  style,
  label,
}: {
  name: string;
  width?: number;
  style?: StyleProp<ViewStyle>;
  label?: string;
}) {
  const [sheet, x, y, w, h] = regions[name] ?? regions.room!;
  const [sw, sh] = sheet === "00-home" ? [1024, 1536] : [1536, 1024];
  return (
    <View
      accessible={!!label}
      accessibilityLabel={label}
      style={[
        { width: width ?? "100%", aspectRatio: w / h, overflow: "hidden" },
        style,
      ]}
    >
      <Image
        accessible={false}
        resizeMode="stretch"
        source={sheets[sheet]!}
        style={{
          position: "absolute",
          width: `${(sw! / w) * 100}%`,
          height: `${(sh! / h) * 100}%`,
          left: `${(-x / w) * 100}%`,
          top: `${(-y / h) * 100}%`,
        }}
      />
    </View>
  );
}
