import assert from 'node:assert/strict';
import test from 'node:test';
import { lightColors,darkColors } from '../../theme/palette';
import { lightWorld,darkWorld } from '../../theme/world';
import { makeRealMapStyles } from './styles';
import { contrast } from '../../theme/contrast';
test('real discovery uses theme text/background tokens in light and dark and 48dp controls',()=>{
  for(const [palette,world] of [[lightColors,lightWorld],[darkColors,darkWorld]] as const){
    const s=makeRealMapStyles(palette,world);assert.equal(s.screen.backgroundColor,world.page);
    assert.equal(s.name.color,world.cardInk);assert.equal(s.muted.color,world.cardMuted);
    assert.equal(s.buttonText.color,palette.onPrimaryContainer);assert.ok(s.button.minHeight>=48);
    assert.equal(s.input.backgroundColor,world.card);
    assert.ok(contrast(s.name.color,world.card)>=4.5);
    assert.ok(contrast(s.muted.color,world.card)>=4.5);
    assert.ok(contrast(s.buttonText.color,s.button.backgroundColor)>=4.5);
  }
});
