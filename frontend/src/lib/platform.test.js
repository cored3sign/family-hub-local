import { describe, it, expect } from 'vitest'
import { isStandaloneApp, isIosDevice, isIosSafariTab } from './platform.js'

const IPHONE_SAFARI = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile/15E148 Safari/604.1', maxTouchPoints: 5 }
const IPAD_DESKTOP_UA = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15', maxTouchPoints: 5 }
const MAC = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15', maxTouchPoints: 0 }
const ANDROID = { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36', maxTouchPoints: 5 }

const standalone = (navigator) => ({ navigator, matchMedia: () => ({ matches: true }) })
const browser = (navigator) => ({ navigator, matchMedia: () => ({ matches: false }) })

describe('isStandaloneApp', () => {
  it('is true for a display-mode standalone page, or iOS navigator.standalone', () => {
    expect(isStandaloneApp({ matchMedia: () => ({ matches: true }), navigator: {} })).toBe(true)
    expect(isStandaloneApp({ navigator: { standalone: true } })).toBe(true)
  })

  it('is false in a browser tab', () => {
    expect(isStandaloneApp(browser(IPHONE_SAFARI))).toBe(false)
    expect(isStandaloneApp({ navigator: {} })).toBe(false)
  })
})

describe('isIosDevice', () => {
  it('knows iPhone, iPad, and an iPad that reports itself as a touch Mac', () => {
    expect(isIosDevice(IPHONE_SAFARI)).toBe(true)
    expect(isIosDevice({ userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)', maxTouchPoints: 5 })).toBe(true)
    expect(isIosDevice(IPAD_DESKTOP_UA)).toBe(true)
  })

  it('is false for a Mac without a touch screen, and for Android', () => {
    expect(isIosDevice(MAC)).toBe(false)
    expect(isIosDevice(ANDROID)).toBe(false)
    expect(isIosDevice(undefined)).toBe(false)
  })
})

describe('isIosSafariTab', () => {
  it('is true for an iPhone or iPad Safari tab', () => {
    expect(isIosSafariTab(browser(IPHONE_SAFARI))).toBe(true)
    expect(isIosSafariTab(browser(IPAD_DESKTOP_UA))).toBe(true)
  })

  it('is false for the Home Screen app on iPhone, and for Android or a Mac', () => {
    expect(isIosSafariTab(standalone(IPHONE_SAFARI))).toBe(false)
    expect(isIosSafariTab(browser(ANDROID))).toBe(false)
    expect(isIosSafariTab(browser(MAC))).toBe(false)
  })
})
