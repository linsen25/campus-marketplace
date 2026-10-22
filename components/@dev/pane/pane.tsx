import { useAtom } from 'jotai'
import { useRouter } from 'next/router'
import { useEffect, useRef } from 'react'
import { Pane as Tweakpane } from 'tweakpane'

import { debugLayerEnabledAtom } from '@dev/debug-layer/debug-layer'
import { gridsHiddenAtom } from '@dev/grids/grids'

export function Pane() {
  const paneContainer = useRef(null)
  const router = useRouter()

  const [gridsHidden, setGridsHidden] = useAtom(gridsHiddenAtom)
  const [debugLayerEnabled, setDebugLayerEnabled] = useAtom(
    debugLayerEnabledAtom
  )

  useEffect(() => {
    const pane = new Tweakpane({
      title: 'Dev',
      expanded: false,
      container: paneContainer.current!,
    })

    // Routes
    const routesFolder = pane.addFolder({ title: 'Routes' })
    routesFolder
      .addInput(router, 'route', {
        label: 'Current route',
        options: {
          index: '/',
          catalog: '/catalog',
          'kit/buttons': '/kit/buttons',
          'kit/chips': '/kit/chips',
          'kit/banners': '/kit/banners',
        },
      })
      .on('change', (ev) => {
        router.push(ev.value)
      })

    // Grids
    const gridFolder = pane.addFolder({ title: 'Grid' })
    gridFolder
      .addInput({ gridsHidden }, 'gridsHidden', { label: 'Hidden' })
      .on('change', (ev) => {
        setGridsHidden(ev.value)
      })

    // Debug layer
    const debugLayerFolder = pane.addFolder({ title: 'Debug Layer' })
    debugLayerFolder
      .addInput({ debugLayerEnabled }, 'debugLayerEnabled', {
        label: 'Enabled',
      })
      .on('change', (ev) => {
        setDebugLayerEnabled(ev.value)
      })

    return () => {
      pane.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paneContainer])

  return <div className="fixed bottom-3 left-3" ref={paneContainer} />
}
