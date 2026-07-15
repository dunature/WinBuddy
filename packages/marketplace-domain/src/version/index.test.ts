import { describe, expect, test } from 'bun:test'
import {
  compareMarketplaceVersions,
  isValidMarketplaceVersion,
  satisfiesPromaVersion,
} from './index.ts'

describe('marketplace version', () => {
  test('接受正式版、prerelease 和 build metadata', () => {
    expect(isValidMarketplaceVersion('1.0.0')).toBe(true)
    expect(isValidMarketplaceVersion('1.0.0-beta.1')).toBe(true)
    expect(isValidMarketplaceVersion('2.1.3+build.5')).toBe(true)
  })

  test('拒绝缩写、v 前缀和前导零', () => {
    for (const value of ['v1', 'v1.0.0', '1.0', '01.0.0', '-1.0.0']) {
      expect(isValidMarketplaceVersion(value)).toBe(false)
    }
  })

  test('prerelease 低于正式版', () => {
    expect(compareMarketplaceVersions('1.0.0-beta.1', '1.0.0')).toBeLessThan(0)
  })

  test('检查 Proma 兼容范围', () => {
    expect(satisfiesPromaVersion('0.14.24', '>=0.14.0 <0.15.0')).toBe(true)
  })
})
