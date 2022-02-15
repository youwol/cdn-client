/** @format */

// eslint-disable-next-line eslint-comments/disable-enable-pair -- to not have problem
/* eslint-disable jest/no-done-callback -- eslint-comment Find a good way to work with rxjs in jest */

import './mock-requests'
import { cleanDocument, installPackages$ } from './common'
import { CdnMessageEvent, install, LoadingScreenView } from '../lib'

beforeAll((done) => {
    installPackages$().subscribe(() => {
        done()
    })
})

beforeEach(() => {
    cleanDocument()
})

test('install success & custom message', async () => {
    const loadingScreen = new LoadingScreenView({
        container: document.body,
        mode: 'svg',
    })
    loadingScreen.render()

    await install(
        {
            modules: ['root'],
        },
        {
            onEvent: (ev) => loadingScreen.next(ev),
        },
    )
    loadingScreen.next(
        new CdnMessageEvent('custom-message', 'A custom message'),
    )
    const elem = document.getElementById('custom-message')
    expect(elem).toBeTruthy()
    expect(elem.textContent).toBe('> A custom message')
})