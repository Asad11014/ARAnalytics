import { createContext, useContext, useState } from 'react'

const UIContext = createContext({})

export function UIProvider({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  return (
    <UIContext.Provider value={{
      sidebarOpen,
      openSidebar:  () => setSidebarOpen(true),
      closeSidebar: () => setSidebarOpen(false),
    }}>
      {children}
    </UIContext.Provider>
  )
}

export const useUI = () => useContext(UIContext)
