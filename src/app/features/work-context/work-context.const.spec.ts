import { hasAllBackgroundImages, hasAnyBackgroundImage } from './work-context.const';

describe('work-context theme background image helpers', () => {
  it('should detect no background images', () => {
    const model = {
      backgroundImageDark: '',
      backgroundImageLight: null,
    };

    expect(hasAnyBackgroundImage(model)).toBe(false);
    expect(hasAllBackgroundImages(model)).toBe(false);
  });

  it('should detect a dark background image only', () => {
    const model = {
      backgroundImageDark: 'assets/bg/dark.jpg',
      backgroundImageLight: '',
    };

    expect(hasAnyBackgroundImage(model)).toBe(true);
    expect(hasAllBackgroundImages(model)).toBe(false);
  });

  it('should detect a light background image only', () => {
    const model = {
      backgroundImageDark: null,
      backgroundImageLight: 'assets/bg/light.jpg',
    };

    expect(hasAnyBackgroundImage(model)).toBe(true);
    expect(hasAllBackgroundImages(model)).toBe(false);
  });

  it('should detect both background images', () => {
    const model = {
      backgroundImageDark: 'assets/bg/dark.jpg',
      backgroundImageLight: 'assets/bg/light.jpg',
    };

    expect(hasAnyBackgroundImage(model)).toBe(true);
    expect(hasAllBackgroundImages(model)).toBe(true);
  });
});
