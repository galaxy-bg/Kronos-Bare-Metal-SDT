import React from 'react';
import ReactDOM from 'react-dom/client';
import { CssBaseline, ThemeProvider, createTheme } from '@mui/material';
import { RouterProvider, createBrowserRouter } from 'react-router-dom';
import App from './App';
import { DashboardPage } from './pages/DashboardPage';
import { ServerDetailPage } from './pages/ServerDetailPage';
import './styles.css';

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#4fb48d',
      light: '#eaf7f2',
      dark: '#22835e',
      contrastText: '#ffffff',
    },
    secondary: {
      main: '#202326',
    },
    success: {
      main: '#2ba36b',
    },
    error: {
      main: '#c2413a',
    },
    text: {
      primary: '#2b2d30',
      secondary: '#62666f',
    },
    background: {
      default: '#fbfdfc',
      paper: '#ffffff',
    },
    divider: '#d7eee5',
  },
  shape: {
    borderRadius: 8,
  },
  typography: {
    fontFamily: ['Inter', 'Roboto', 'Arial', 'sans-serif'].join(','),
    h4: {
      letterSpacing: 0,
    },
    h5: {
      letterSpacing: 0,
    },
    h6: {
      letterSpacing: 0,
    },
    button: {
      fontWeight: 800,
      textTransform: 'none',
      letterSpacing: 0,
    },
  },
  components: {
    MuiPaper: {
      styleOverrides: {
        root: {
          borderColor: '#d7eee5',
          boxShadow: '0 18px 44px rgba(23, 46, 38, 0.06)',
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          boxShadow: 'none',
        },
        outlined: {
          borderColor: '#c7e8dc',
          color: '#2b2d30',
          backgroundColor: '#ffffff',
        },
        contained: {
          boxShadow: 'none',
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          fontWeight: 800,
          borderRadius: 6,
          letterSpacing: 0,
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        head: {
          color: '#2b2d30',
          fontWeight: 800,
          backgroundColor: '#f1faf6',
          borderBottomColor: '#d7eee5',
        },
        body: {
          borderBottomColor: '#edf6f2',
        },
      },
    },
  },
});

const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'servers/:serverId', element: <ServerDetailPage /> },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <RouterProvider router={router} />
    </ThemeProvider>
  </React.StrictMode>,
);
