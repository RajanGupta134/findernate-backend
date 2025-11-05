# Facebook-Style Comment Threading - Frontend Implementation Guide

## Overview
The backend now supports Facebook-style nested comment threading where:
- Users can reply to any comment at any nesting level
- All replies in a thread stay together
- Each reply shows who is being replied to
- Depth information is provided for proper UI indentation

---

## API Endpoints

### 1. Create a Comment/Reply

**Endpoint:** `POST /api/v1/post/comment`

**Request Body:**
```javascript
{
  postId: string,           // Required - The post being commented on
  content: string,          // Required - The comment text
  parentCommentId?: string, // Optional - ID of comment being replied to (null for top-level)
  replyToUserId?: string    // Optional - User being mentioned (auto-detected if not provided)
}
```

**Example - Top-level comment:**
```javascript
const response = await fetch('/api/v1/post/comment', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    postId: '507f1f77bcf86cd799439011',
    content: 'This is an amazing post!'
  })
});
```

**Example - Reply to a comment:**
```javascript
const response = await fetch('/api/v1/post/comment', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    postId: '507f1f77bcf86cd799439011',
    content: 'I totally agree!',
    parentCommentId: '507f1f77bcf86cd799439022' // The comment being replied to
  })
});
```

**Response:**
```javascript
{
  statusCode: 201,
  data: {
    _id: '507f1f77bcf86cd799439033',
    postId: '507f1f77bcf86cd799439011',
    userId: {
      _id: '507f1f77bcf86cd799439044',
      username: 'john_doe',
      fullName: 'John Doe',
      profileImageUrl: 'https://...',
      bio: '...',
      location: '...'
    },
    content: 'I totally agree!',
    parentCommentId: '507f1f77bcf86cd799439022',
    rootCommentId: '507f1f77bcf86cd799439022',  // Top of the thread
    replyToUserId: {  // Who is being replied to (populated)
      _id: '507f1f77bcf86cd799439055',
      username: 'jane_smith',
      fullName: 'Jane Smith',
      profileImageUrl: 'https://...'
    },
    likes: [],
    isEdited: false,
    isDeleted: false,
    createdAt: '2025-01-05T12:00:00.000Z',
    updatedAt: '2025-01-05T12:00:00.000Z'
  },
  message: 'Comment created successfully'
}
```

---

### 2. Get Top-Level Comments for a Post

**Endpoint:** `GET /api/v1/post/comments?postId={postId}&page={page}&limit={limit}`

**Query Parameters:**
- `postId` (required): The post ID
- `page` (optional, default: 1): Page number
- `limit` (optional, default: 20): Comments per page

**Example:**
```javascript
const response = await fetch('/api/v1/post/comments?postId=507f1f77bcf86cd799439011&page=1&limit=20');
```

**Response:**
```javascript
{
  statusCode: 200,
  data: {
    totalComments: 45,
    page: 1,
    totalPages: 3,
    comments: [
      {
        _id: '507f1f77bcf86cd799439022',
        postId: '507f1f77bcf86cd799439011',
        userId: {
          _id: '507f1f77bcf86cd799439044',
          username: 'jane_smith',
          fullName: 'Jane Smith',
          profileImageUrl: 'https://...',
          bio: '...',
          location: '...'
        },
        content: 'Great post!',
        parentCommentId: null,  // Top-level comment
        rootCommentId: null,
        replyToUserId: null,    // Not replying to anyone
        likes: [...],           // Array of user objects who liked
        isLikedBy: false,       // Whether current user liked it
        likesCount: 12,
        replyCount: 8,          // Total replies in this thread
        isEdited: false,
        isDeleted: false,
        createdAt: '2025-01-05T11:00:00.000Z',
        updatedAt: '2025-01-05T11:00:00.000Z'
      },
      // ... more top-level comments
    ]
  },
  message: 'Comments fetched successfully'
}
```

---

### 3. Get Full Thread (Comment + All Nested Replies)

**Endpoint:** `GET /api/v1/post/comment/{commentId}?page={page}&limit={limit}`

**Path Parameters:**
- `commentId` (required): The root comment ID

**Query Parameters:**
- `page` (optional, default: 1): Page number for replies
- `limit` (optional, default: 10): Replies per page

**Example:**
```javascript
const response = await fetch('/api/v1/post/comment/507f1f77bcf86cd799439022?page=1&limit=50');
```

**Response:**
```javascript
{
  statusCode: 200,
  data: {
    comment: {
      // Root comment (same structure as above)
      _id: '507f1f77bcf86cd799439022',
      userId: {...},
      content: 'Great post!',
      replyCount: 8,
      // ... other fields
    },
    replies: {
      totalReplies: 8,
      page: 1,
      totalPages: 1,
      comments: [
        {
          _id: '507f1f77bcf86cd799439033',
          userId: {
            username: 'john_doe',
            fullName: 'John Doe',
            profileImageUrl: '...'
          },
          content: 'I agree!',
          parentCommentId: '507f1f77bcf86cd799439022',  // Immediate parent
          rootCommentId: '507f1f77bcf86cd799439022',    // Thread root
          replyToUserId: {  // Who they're replying to
            username: 'jane_smith',
            fullName: 'Jane Smith',
            profileImageUrl: '...'
          },
          depth: 1,  // ⭐ Nesting level (1 = direct reply to root)
          likes: [],
          isLikedBy: false,
          likesCount: 3,
          replyCount: 2,  // How many replied to THIS comment
          createdAt: '2025-01-05T11:30:00.000Z'
        },
        {
          _id: '507f1f77bcf86cd799439044',
          userId: {
            username: 'mike_jones',
            fullName: 'Mike Jones',
            profileImageUrl: '...'
          },
          content: 'Same here!',
          parentCommentId: '507f1f77bcf86cd799439033',  // Reply to John's comment
          rootCommentId: '507f1f77bcf86cd799439022',    // Still same thread root
          replyToUserId: {  // Replying to John
            username: 'john_doe',
            fullName: 'John Doe',
            profileImageUrl: '...'
          },
          depth: 2,  // ⭐ Nested one level deeper
          likes: [],
          isLikedBy: false,
          likesCount: 1,
          replyCount: 0,
          createdAt: '2025-01-05T11:45:00.000Z'
        },
        // ... more replies in chronological order
      ]
    }
  },
  message: 'Comment fetched successfully'
}
```

---

### 4. Other Existing Endpoints

**Update Comment:**
```javascript
PUT /api/v1/post/comment/{commentId}
Body: { content: 'Updated text' }
```

**Delete Comment:**
```javascript
DELETE /api/v1/post/comment/{commentId}
```

**Like Comment:**
```javascript
POST /api/v1/post/like-comment
Body: { commentId: '...' }
```

**Unlike Comment:**
```javascript
DELETE /api/v1/post/unlike-comment
Body: { commentId: '...' }
```

---

## UI/UX Implementation Guide

### 1. Display Top-Level Comments

**Recommended Flow:**
1. Fetch top-level comments using `GET /api/v1/post/comments`
2. Display each comment with a "View Replies (X)" button if `replyCount > 0`
3. Add a "Reply" button to each comment

**Example React Component:**
```jsx
function CommentList({ postId }) {
  const [comments, setComments] = useState([]);
  const [page, setPage] = useState(1);

  useEffect(() => {
    fetchComments();
  }, [postId, page]);

  const fetchComments = async () => {
    const res = await fetch(`/api/v1/post/comments?postId=${postId}&page=${page}&limit=20`);
    const data = await res.json();
    setComments(data.data.comments);
  };

  return (
    <div className="comments-section">
      {comments.map(comment => (
        <CommentItem
          key={comment._id}
          comment={comment}
          postId={postId}
        />
      ))}
    </div>
  );
}
```

---

### 2. Display Nested Replies (Facebook Style)

**Key Features:**
- ✅ Show who is being replied to: **"@username"** or **"Replying to username"**
- ✅ Use `depth` field for indentation (max depth: 3-4 levels to avoid UI cramping)
- ✅ Allow replying to any comment in the thread
- ✅ Show replies in chronological order

**Example React Component:**
```jsx
function CommentItem({ comment, postId, depth = 0 }) {
  const [showReplies, setShowReplies] = useState(false);
  const [replies, setReplies] = useState([]);
  const [showReplyInput, setShowReplyInput] = useState(false);

  const fetchReplies = async () => {
    const res = await fetch(`/api/v1/post/comment/${comment._id}?page=1&limit=50`);
    const data = await res.json();
    setReplies(data.data.replies.comments);
    setShowReplies(true);
  };

  const handleReply = async (content) => {
    const res = await fetch('/api/v1/post/comment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        postId,
        content,
        parentCommentId: comment._id
      })
    });

    const newReply = await res.json();
    setReplies([...replies, newReply.data]);
    setShowReplyInput(false);
  };

  // Calculate indentation (max 3 levels to prevent UI cramping)
  const indentLevel = Math.min(depth, 3);
  const marginLeft = indentLevel * 40; // 40px per level

  return (
    <div style={{ marginLeft: `${marginLeft}px` }} className="comment">
      {/* User Avatar */}
      <img
        src={comment.userId.profileImageUrl}
        alt={comment.userId.username}
        className="avatar"
      />

      <div className="comment-content">
        {/* Username and timestamp */}
        <div className="comment-header">
          <strong>{comment.userId.fullName}</strong>
          <span className="timestamp">{formatTime(comment.createdAt)}</span>
        </div>

        {/* Reply mention (Facebook-style) */}
        {comment.replyToUserId && (
          <div className="reply-mention">
            Replying to <strong>@{comment.replyToUserId.username}</strong>
          </div>
        )}

        {/* Comment text */}
        <p className="comment-text">{comment.content}</p>

        {/* Actions */}
        <div className="comment-actions">
          <button onClick={() => handleLike(comment._id)}>
            {comment.isLikedBy ? '❤️' : '🤍'} {comment.likesCount}
          </button>

          <button onClick={() => setShowReplyInput(!showReplyInput)}>
            Reply
          </button>

          {comment.replyCount > 0 && !showReplies && (
            <button onClick={fetchReplies}>
              View {comment.replyCount} {comment.replyCount === 1 ? 'reply' : 'replies'}
            </button>
          )}

          {showReplies && (
            <button onClick={() => setShowReplies(false)}>
              Hide replies
            </button>
          )}
        </div>

        {/* Reply input */}
        {showReplyInput && (
          <CommentInput
            onSubmit={handleReply}
            placeholder={`Reply to ${comment.userId.username}...`}
            autoFocus
          />
        )}

        {/* Nested replies */}
        {showReplies && replies.length > 0 && (
          <div className="replies-thread">
            {replies.map(reply => (
              <CommentItem
                key={reply._id}
                comment={reply}
                postId={postId}
                depth={reply.depth} // Use depth from backend
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

---

### 3. CSS Styling (Example)

```css
.comment {
  display: flex;
  gap: 12px;
  padding: 12px;
  border-left: 2px solid transparent;
  transition: all 0.2s;
}

.comment:hover {
  background-color: #f5f5f5;
  border-left-color: #1877f2;
}

.comment .avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  flex-shrink: 0;
}

.comment-content {
  flex: 1;
}

.comment-header {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 4px;
}

.comment-header strong {
  font-weight: 600;
  color: #050505;
}

.timestamp {
  font-size: 12px;
  color: #65676b;
}

/* Reply mention (Facebook-style) */
.reply-mention {
  font-size: 13px;
  color: #65676b;
  margin-bottom: 4px;
}

.reply-mention strong {
  color: #1877f2;
  cursor: pointer;
}

.comment-text {
  margin: 4px 0 8px 0;
  color: #050505;
  font-size: 15px;
  line-height: 1.4;
}

.comment-actions {
  display: flex;
  gap: 16px;
  font-size: 13px;
}

.comment-actions button {
  background: none;
  border: none;
  color: #65676b;
  cursor: pointer;
  font-weight: 600;
  padding: 4px 8px;
  border-radius: 4px;
}

.comment-actions button:hover {
  background-color: #f2f2f2;
}

/* Replies thread */
.replies-thread {
  margin-top: 12px;
  border-left: 2px solid #e4e6eb;
  padding-left: 12px;
}

/* Max nesting depth indicator */
.comment[style*="margin-left: 120px"] .comment-actions button[data-action="reply"] {
  /* Optionally hide reply button at max depth */
  /* display: none; */
}
```

---

### 4. Mobile Optimization

For mobile devices, reduce indentation:

```css
@media (max-width: 768px) {
  .comment {
    margin-left: 0 !important; /* Remove indentation on mobile */
  }

  /* Use different visual indicator */
  .comment[data-depth="1"] {
    border-left: 3px solid #1877f2;
    padding-left: 12px;
  }

  .comment[data-depth="2"] {
    border-left: 3px solid #65676b;
    padding-left: 12px;
  }
}
```

---

## State Management Recommendations

### Option 1: Flat List with Depth (Recommended for Facebook-style)

Store replies in a flat array with depth information:

```javascript
const [threadData, setThreadData] = useState({
  rootComment: null,
  replies: [] // Flat array with depth property
});

// Render with indentation based on depth
{replies.map(reply => (
  <CommentItem
    key={reply._id}
    comment={reply}
    style={{ marginLeft: `${Math.min(reply.depth, 3) * 40}px` }}
  />
))}
```

**Benefits:**
- Simple to implement
- Easy pagination
- Matches backend response structure
- No complex tree traversal

### Option 2: Nested Tree Structure

If you prefer a nested UI library:

```javascript
// Transform flat list to tree
function buildCommentTree(replies) {
  const map = {};
  const roots = [];

  replies.forEach(reply => {
    map[reply._id] = { ...reply, children: [] };
  });

  replies.forEach(reply => {
    if (reply.parentCommentId && map[reply.parentCommentId]) {
      map[reply.parentCommentId].children.push(map[reply._id]);
    } else {
      roots.push(map[reply._id]);
    }
  });

  return roots;
}
```

---

## Real-Time Updates (Optional)

If you're using Socket.IO for real-time features:

```javascript
// Listen for new comments
socket.on('new-comment', (newComment) => {
  if (newComment.rootCommentId === currentThreadId) {
    // Add to current thread
    setReplies(prev => [...prev, newComment]);
  }
});

// Listen for notifications
socket.on('notification', (notification) => {
  if (notification.type === 'comment' && notification.message === 'replied to your comment') {
    showToast(`${notification.sender.username} replied to your comment`);
  }
});
```

---

## Best Practices

### 1. **Lazy Loading**
- Load top-level comments on page load
- Load replies only when user clicks "View replies"
- Implement infinite scroll for large comment sections

### 2. **Optimistic Updates**
```javascript
const handleReply = async (content) => {
  // Add comment optimistically
  const tempComment = {
    _id: 'temp-' + Date.now(),
    content,
    userId: currentUser,
    createdAt: new Date().toISOString(),
    isLikedBy: false,
    likesCount: 0,
    depth: parentComment.depth + 1
  };

  setReplies(prev => [...prev, tempComment]);

  try {
    const res = await fetch('/api/v1/post/comment', {
      method: 'POST',
      body: JSON.stringify({ postId, content, parentCommentId })
    });

    const realComment = await res.json();

    // Replace temp with real comment
    setReplies(prev => prev.map(c =>
      c._id === tempComment._id ? realComment.data : c
    ));
  } catch (error) {
    // Remove temp comment on error
    setReplies(prev => prev.filter(c => c._id !== tempComment._id));
    showError('Failed to post comment');
  }
};
```

### 3. **Max Depth Handling**
```javascript
const MAX_DEPTH = 3;

// If at max depth, don't allow further nesting
{comment.depth < MAX_DEPTH && (
  <button onClick={() => setShowReplyInput(true)}>
    Reply
  </button>
)}
```

### 4. **Performance**
- Use `React.memo()` for comment components
- Virtualize long comment lists with `react-window` or `react-virtual`
- Debounce like/unlike actions

### 5. **Accessibility**
```jsx
<button
  onClick={handleReply}
  aria-label={`Reply to ${comment.userId.username}'s comment`}
>
  Reply
</button>

<div role="article" aria-label="Comment">
  {/* Comment content */}
</div>
```

---

## Testing Checklist

- [ ] Top-level comment creation
- [ ] Reply to top-level comment (depth 1)
- [ ] Reply to reply (depth 2+)
- [ ] Reply mention displays correctly
- [ ] Thread fetching shows all nested replies
- [ ] Likes work on all depth levels
- [ ] Edit/delete work on nested comments
- [ ] Pagination works correctly
- [ ] Mobile responsive design
- [ ] Loading states
- [ ] Error handling
- [ ] Empty states
- [ ] Notification for replies

---

## Example Full Implementation (React)

See the complete working example in the next section...

```jsx
// Complete example with hooks, state management, and error handling
// Available on request
```

---

## Questions?

Contact backend team if you need:
- Additional API endpoints
- Different response format
- Real-time notification structure
- Performance optimization help
