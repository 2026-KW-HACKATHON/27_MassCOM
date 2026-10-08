import React from 'react';
import { AppRegistry } from 'react-native';

import App from './App';

const Root = () => {
  const strict = new URLSearchParams(window.location.search).get('strict') === '1';
  return strict ? (
    <React.StrictMode>
      <App />
    </React.StrictMode>
  ) : (
    <App />
  );
};

AppRegistry.registerComponent('RewardAlbumQa', () => Root);
AppRegistry.runApplication('RewardAlbumQa', {
  rootTag: document.getElementById('root'),
});
