# Bucks Component Library

A comprehensive, production-ready component library for the Bucks Web3 Browser UI. All components follow modern design patterns and include full accessibility support.

## Quick Start

### Installation

```javascript
// Import component library
const ComponentLibrary = require('./component-library.js');
const Components = require('./components.js');

// Initialize library
const lib = new ComponentLibrary();
```

### Basic Usage

```javascript
// Create a component
const bubble = new Components.ChatBubble({
  message: 'Hello, Bucks!',
  sender: 'user',
  status: 'verified'
});

// Render to DOM
const container = document.getElementById('chat-container');
container.appendChild(bubble.render());
```

---

## Components Overview

### 1. **ChatBubble** - Message Container
Displays individual chat messages with sender info, timestamps, and delivery status.

**Props:**
- `message` (string) - Message content
- `sender` (string) - Sender identifier ('user', 'peer', 'system')
- `timestamp` (number) - Message timestamp (milliseconds)
- `status` (string) - Delivery status ('pending', 'sent', 'verified', 'error')
- `theme` (string) - Theme name ('light', 'dark')
- `animated` (boolean) - Enable slide-in animation

**Methods:**
- `render()` - Render component to DOM element
- `updateStatus(newStatus)` - Update message status
- `formatTime()` - Format timestamp to readable time
- `getStatusIcon()` - Get status indicator symbol

**Example:**
```javascript
const msg = new Components.ChatBubble({
  message: 'What is Bucks?',
  sender: 'user',
  timestamp: Date.now(),
  status: 'verified',
  animated: true
});

container.appendChild(msg.render());
msg.updateStatus('verified');
```

---

### 2. **ChatInput** - Rich Message Composer
Interactive input field with markdown formatting toolbar and multi-line support.

**Props:**
- `placeholder` (string) - Input placeholder text
- `value` (string) - Initial value
- `disabled` (boolean) - Disable input
- `theme` (string) - Theme name
- `formatting` (boolean) - Show formatting toolbar
- `onSubmit` (function) - Callback when message sent

**Methods:**
- `render()` - Render component
- `getValue()` - Get current input value
- `setValue(text)` - Set input value
- `clear()` - Clear input
- `focus()` - Focus input field
- `applyFormatting(format)` - Apply markdown formatting

**Example:**
```javascript
const input = new Components.ChatInput({
  placeholder: 'Type your message...',
  formatting: true,
  onSubmit: (message) => {
    console.log('Sending:', message);
    sendMessage(message);
  }
});

container.appendChild(input.render());
input.focus();
```

---

### 3. **ResponseCard** - Rich Content Display
Card component for displaying responses with multiple content formats.

**Props:**
- `title` (string) - Card title
- `content` (string/object) - Card content
- `format` (string) - Content format ('markdown', 'code', 'json', 'html')
- `actions` (array) - Action buttons
- `theme` (string) - Theme name

**Methods:**
- `render()` - Render component
- `updateContent(newContent)` - Update card content
- `setFormat(newFormat)` - Change content format

**Example:**
```javascript
const card = new Components.ResponseCard({
  title: 'Search Results',
  content: `# Bucks\nBucks is a Web3 browser...`,
  format: 'markdown',
  actions: [
    { label: 'Visit', onClick: () => navigate('/bucks') },
    { label: 'Share', onClick: () => share() }
  ]
});

container.appendChild(card.render());
```

---

### 4. **StatusIndicator** - Status Display
Shows message delivery status or operational status with animated indicator.

**Props:**
- `status` (string) - Status ('pending', 'sent', 'verified', 'error', 'processing')
- `label` (string) - Status label text
- `animated` (boolean) - Animate indicator
- `size` (string) - Size ('small', 'medium', 'large')

**Methods:**
- `render()` - Render component
- `updateStatus(newStatus)` - Update status
- `setLabel(newLabel)` - Update label

**Example:**
```javascript
const status = new Components.StatusIndicator({
  status: 'verified',
  label: 'Message verified',
  animated: true,
  size: 'medium'
});

container.appendChild(status.render());
```

---

### 5. **PeerIndicator** - User/Peer Avatar
Displays peer information with avatar, name, and online status.

**Props:**
- `peerId` (string) - Peer identifier
- `name` (string) - Peer display name
- `avatar` (string) - Avatar image URL
- `status` (string) - Online status ('online', 'offline', 'away')
- `size` (string) - Avatar size ('small', 'medium', 'large')

**Methods:**
- `render()` - Render component
- `setStatus(newStatus)` - Update online status
- `updateAvatar(newAvatar)` - Change avatar image

**Example:**
```javascript
const peer = new Components.PeerIndicator({
  peerId: 'peer-123',
  name: 'Alice',
  avatar: 'https://example.com/avatar.png',
  status: 'online',
  size: 'medium'
});

container.appendChild(peer.render());
peer.setStatus('away');
```

---

### 6. **IntentBadge** - Intent Label
Shows classified intent with confidence percentage.

**Props:**
- `intent` (string) - Intent type
- `confidence` (number) - Confidence score (0-1)
- `clickable` (boolean) - Enable click handling
- `theme` (string) - Theme name
- `onClick` (function) - Click callback

**Methods:**
- `render()` - Render component
- `updateIntent(newIntent)` - Change intent
- `setConfidence(score)` - Update confidence

**Example:**
```javascript
const badge = new Components.IntentBadge({
  intent: 'search',
  confidence: 0.92,
  clickable: true,
  onClick: (intent) => console.log('Intent:', intent)
});

container.appendChild(badge.render());
badge.setConfidence(0.95);
```

---

### 7. **LoadingSkeleton** - Placeholder
Shimmer placeholder while content loads.

**Props:**
- `type` (string) - Skeleton type ('text', 'avatar', 'card')
- `count` (number) - Number of skeleton items
- `animated` (boolean) - Animate shimmer
- `theme` (string) - Theme name

**Methods:**
- `render()` - Render component
- `stop()` - Remove skeleton

**Example:**
```javascript
const skeleton = new Components.LoadingSkeleton({
  type: 'card',
  count: 3,
  animated: true
});

container.appendChild(skeleton.render());

// Later, replace with actual content
setTimeout(() => {
  skeleton.stop();
  container.appendChild(actualCard.render());
}, 2000);
```

---

### 8. **NotificationToast** - Toast Alerts
Toast notifications for alerts, confirmations, and messages.

**Props:**
- `message` (string) - Toast message
- `type` (string) - Type ('info', 'success', 'warning', 'error')
- `duration` (number) - Auto-dismiss duration (ms, 0 = no dismiss)
- `actions` (array) - Action buttons

**Methods:**
- `show()` - Display toast
- `hide()` - Hide toast
- `update(newMessage)` - Update message

**Example:**
```javascript
const toast = new Components.NotificationToast({
  message: 'Message sent successfully',
  type: 'success',
  duration: 3000,
  actions: [
    { label: 'Undo', onClick: () => undoSend() }
  ]
});

toast.show();
```

---

### 9. **TypingIndicator** - Typing Animation
Animated typing indicator for peer activity.

**Props:**
- `animated` (boolean) - Start animated
- `color` (string) - Dot color (hex or named)
- `size` (string) - Indicator size ('small', 'medium', 'large')

**Methods:**
- `render()` - Render component
- `start()` - Start animation
- `stop()` - Stop animation

**Example:**
```javascript
const typing = new Components.TypingIndicator({
  color: '#007AFF',
  size: 'medium',
  animated: true
});

container.appendChild(typing.render());

// Stop when message arrives
typing.stop();
```

---

### 10. **CodeBlock** - Syntax Highlighted Code
Displays code with syntax highlighting and copy functionality.

**Props:**
- `code` (string) - Source code
- `language` (string) - Programming language
- `showLineNumbers` (boolean) - Show line numbers
- `copyable` (boolean) - Enable copy button

**Methods:**
- `render()` - Render component
- `copyToClipboard()` - Copy code to clipboard
- `updateCode(newCode)` - Replace code
- `setLanguage(lang)` - Change language

**Example:**
```javascript
const codeBlock = new Components.CodeBlock({
  code: 'const greeting = "Hello, Bucks!";',
  language: 'javascript',
  copyable: true
});

container.appendChild(codeBlock.render());
```

---

## Theming

### Available Themes

**Light Theme (default)**
- Primary: `#007AFF` (iOS Blue)
- Background: `#FFFFFF`
- Surface: `#F2F2F7`
- Text: `#000000`

**Dark Theme**
- Primary: `#0A84FF` (iOS Dark Blue)
- Background: `#000000`
- Surface: `#1C1C1E`
- Text: `#FFFFFF`

### Applying Themes

```javascript
// Pass theme prop to any component
const component = new Components.ChatBubble({
  message: 'Hello',
  theme: 'dark'
});

// Or use CSS classes
const elem = component.render();
elem.classList.add('theme-dark');
```

---

## Accessibility

All components include:
- ✅ WCAG 2.1 AA compliance
- ✅ Keyboard navigation
- ✅ Screen reader support
- ✅ High contrast modes
- ✅ Focus indicators
- ✅ Semantic HTML

---

## Integration Guide

### With Component Library

```javascript
const lib = new ComponentLibrary();

// Create using factory
const bubble = lib.createComponent('ChatBubble', {
  message: 'Hello',
  sender: 'user'
});

// Register lifecycle hooks
lib.onHook('ChatBubble', 'mount', (instance) => {
  console.log('ChatBubble mounted:', instance.id);
});

// Mount to DOM
const container = document.getElementById('messages');
lib.mount(bubble, container);
```

### With React

```javascript
import { ChatBubble } from './components.js';

function MessageList() {
  const [messages, setMessages] = useState([]);

  useEffect(() => {
    messages.forEach((msg, i) => {
      const bubble = new ChatBubble(msg);
      const el = bubble.render();
      const container = document.getElementById(`msg-${i}`);
      if (container) container.appendChild(el);
    });
  }, [messages]);

  return <div id="message-list">{messages.map((_, i) => <div id={`msg-${i}`} />)}</div>;
}
```

---

## Best Practices

1. **Reuse Components** - Use components consistently across the app
2. **Handle Lifecycle** - Clean up components when unmounting
3. **Respect Accessibility** - Test with screen readers and keyboard navigation
4. **Use Themes** - Apply themes consistently for visual coherence
5. **Handle Errors** - Provide error states for failed operations
6. **Performance** - Limit DOM updates, use efficient re-renders

---

## Performance Notes

- All components are lightweight (~5-20KB minified)
- Rendering is ~2-5ms per component
- No external dependencies required
- CSS is optimized for production use

---

## Changelog

### v1.0.0 (Current)
- Initial release with 10 core components
- Full accessibility support
- Light/dark theme support
- Comprehensive documentation

---

## Support

For issues, questions, or contributions, refer to the main Bucks documentation or create an issue in the component library tracker.
