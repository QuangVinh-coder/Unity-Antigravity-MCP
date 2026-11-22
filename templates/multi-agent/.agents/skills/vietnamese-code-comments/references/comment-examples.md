# Ví dụ thực hành: ít comment hơn, nhưng đúng hơn

**Dùng khi:** agent cần mẫu văn phong và quyết định viết/xóa. Ví dụ là tài liệu huấn luyện; phần dấu `...` hoặc phương thức giả định **không** được chép thẳng vào source nếu chưa có implementation tương ứng. Không học thuộc câu chữ; đọc ngữ cảnh thật.

## A. Tình huống đơn giản: nên xóa comment

### 01. Getter

**Không nên**

```csharp
// Trả về số Gold hiện tại.
public long Gold { get; private set; }
```

**Nên**

```csharp
public long Gold { get; private set; }
```

`private set` đã thể hiện lớp khác không tự gán Gold.

### 02. Guard null

**Không nên**

```csharp
// Nếu item rỗng thì trả về false để không xử lý tiếp.
if (item == null) return false;
```

**Nên**

```csharp
if (item == null) return false;
```

Chỉ thêm comment nếu `null` có ý nghĩa nghiệp vụ khác thường.

### 03. Vòng lặp

**Không nên**

```csharp
// Duyệt từng slot trong danh sách slot.
foreach (InventorySlot slot in slots) { /* ... */ }
```

**Nên:** Không comment cho bản thân vòng lặp. Nếu thuật toán ưu tiên slot cũ vì một quy tắc kho, comment **quy tắc ấy**, không phải việc `foreach` duyệt danh sách.

### 04. Constructor

**Không nên**

```csharp
/// <summary>
/// Constructor public để các class khác có thể khởi tạo ví.
/// Không có kiểu trả về vì đây là constructor.
/// </summary>
```

**Nên, nếu chưa có hợp đồng ở class:**

```csharp
/// <summary>Khởi tạo ví với số Gold không âm; giá trị âm sẽ gây lỗi.</summary>
```

Hoặc không comment khi điều kiện đã được mô tả đủ ở cấp class và caller không cần biết thêm.

## B. Nghiệp vụ shop: nêu điều kiện và hậu quả

### 05. `Deliver()` và thứ tự trừ tiền

**Không nên**

```csharp
// Đã kiểm sức chứa trong cùng giao dịch đồng bộ.
// Thất bại ở đây báo vi phạm thứ tự, không tự hoàn tác.
```

**Nên (chỉ khi đã kiểm tra caller):**

```csharp
// Kho đã được kiểm tra đủ chỗ ở bước trước.
// Nếu vẫn không thêm được hàng thì dừng mua trước khi trừ Gold.
```

**Vì sao:** Câu mới có chủ thể, tình huống và hệ quả. Trong fixture `ShopOffer.TryPurchase()` gọi `Deliver(quantity)` rồi `wallet.SpendGold(totalPrice)`; exception trong `Deliver()` ngắt luồng trước `SpendGold()`. **Không được nói giao dịch tự rollback.**

### 06. Quy tắc mua đủ hoặc từ chối

**Không nên**

```csharp
// Bảo đảm tính toàn vẹn giao dịch khi lưu nhiều sản phẩm.
```

**Nên, nếu `HasSpaceFor()` được gọi trước mọi mutation:**

```csharp
// Kiểm tra chỗ trống trước khi sửa kho để không cất được nửa số hàng rồi mới báo hết chỗ.
```

**Không** khẳng định an toàn đa luồng hay atomic transaction; đó là hợp đồng mạnh hơn nhiều.

### 07. Tràn số khi tính tiền

**Không nên**

```csharp
// Sử dụng decimal để đảm bảo tính chính xác trong bối cảnh xử lý giá trị.
```

**Nên, nếu phép nhân được chuyển sang `decimal` trước:**

```csharp
// Nhân bằng decimal trước khi ép về long; nếu nhân long ngay, tổng giá có thể tràn trước lúc kiểm tra.
```

### 08. Hai khái niệm số lượng

**Không nên**

```csharp
// Phân biệt quantity với số vật phẩm nhận được theo hợp đồng nghiệp vụ.
```

**Nên:**

```csharp
// Một lượt mua có thể nhận nhiều món, nên giới hạn kho phải tính theo số món nhận được,
// không phải số lần nhấn mua.
```

Chỉ dùng khi dữ liệu cấu hình thật sự có `ItemsPerPurchase` khác 1.

### 09. Ghép ô kho

**Không nên**

```csharp
// Đồng nhất đối tượng nguồn để duy trì sự nhất quán khi xếp chồng.
```

**Nên, nếu hai asset khác nhau dù trùng ItemID không được ghép:**

```csharp
// Hai món trùng mã nhưng dùng hai GoodsDefinition khác nhau vẫn không được chồng chung.
```

### 10. Hàm thanh toán và side effect

**Không nên**

```csharp
/// <summary>Thực thi nghiệp vụ trừ tiền với cơ chế xác thực.</summary>
```

**Nên:**

```csharp
/// <summary>
/// Trừ Gold. Nếu khoản trừ âm hoặc vượt số dư, hàm ném lỗi và giữ nguyên tiền.
/// </summary>
```

## C. Unity: giải thích nơi dễ sửa hỏng

### 11. NativeContainer và job

**Không nên**

```csharp
// Đồng bộ job để bảo toàn tính nhất quán dữ liệu native.
```

**Nên, nếu job thực sự còn đọc/ghi buffer đó:**

```csharp
// Chờ job chạy xong rồi mới sửa grid; nếu sửa sớm, job có thể đọc dữ liệu đang thay đổi.
```

**Không** gắn comment trên mọi `Complete()` nếu một comment trước nhóm xử lý đã giải thích đầy đủ.

### 12. FSM — tránh đổi state sai

**Không nên**

```csharp
// Xác thực transition trong lifecycle trạng thái.
```

**Nên, nếu Death có ưu tiên cao hơn Hit:**

```csharp
// Enemy đã chết thì không được chuyển về Hit, nếu không animation chết có thể bị ngắt.
```

### 13. Lifecycle — event

**Không nên**

```csharp
// Unsubscribe event trong OnDisable để tránh lỗi hệ thống.
```

**Nên, khi điểm đặc biệt không rõ:**

```csharp
// Khi màn hình shop bị ẩn, bỏ lắng nghe thay đổi Gold để UI không cập nhật khi đã tắt.
```

Nếu `OnEnable`/`OnDisable` theo đúng quy ước UCC, người đọc đã biết ý nghĩa, không cần comment ở mỗi lần unsubscribe.

### 14. Unity script binding

**Không nên**

```csharp
// Đảm bảo serialization consistency sau khi refactor.
```

**Nên trong hướng dẫn bảo trì hoặc nơi có kiểm tra GUID thực:**

```csharp
// Đổi file MonoBehaviour có thể làm prefab mất m_Script dù C# vẫn compile;
// phải kiểm tra đúng GUID trên prefab sau khi chuyển file.
```

Thông thường thông tin này hợp lý hơn trong tài liệu refactor/checklist UCC-28, không nhất thiết là comment trong gameplay.

## D. Networking/server: trung thực về lời hứa

### 15. Client gửi lại request

**Không nên**

```csharp
// Đảm bảo cơ chế idempotency cho các sự kiện networking.
```

**Nên, nếu server thật sự lưu và kiểm `requestId`:**

```csharp
// Client có thể gửi lại yêu cầu sau timeout. Nếu requestId đã xử lý, trả kết quả cũ
// để người chơi không bị trừ Gold hai lần.
```

Nếu không có cơ chế kiểm `requestId` trong code, **đừng viết câu này**. Nêu finding thiếu idempotency thay vì comment giả.

### 16. Server authority

**Không nên**

```csharp
// Đồng bộ dữ liệu có thẩm quyền trong quá trình xử lý.
```

**Nên, khi server thực sự xác nhận sát thương:**

```csharp
// Chỉ server tính sát thương cuối cùng; client gửi yêu cầu và nhận kết quả,
// không tự quyết định máu của enemy.
```

### 17. Timeout

**Không nên**

```csharp
// Xử lý ngoại lệ timeout trong bối cảnh mạng.
```

**Nên, nếu logic có retry:**

```csharp
// Timeout không có nghĩa server chưa xử lý xong; kiểm lại mã yêu cầu trước khi thử gửi lại.
```

### 18. Ví dụ nguồn thật và giả định

**Không nên**

```csharp
// Đã xác thực trong Play Mode và bảo đảm mọi phiên chơi không mất dữ liệu.
```

**Nên:** Không dùng comment để ghi kết quả test hoặc cam kết thiếu bằng chứng. Đưa kết quả test vào báo cáo bằng chứng, ghi rõ phiên bản và cách chạy.

## E. Tự chấm ví dụ

Mỗi ví dụ chỉ được dùng nếu xác minh **đúng với source hiện tại**. Khi style mới làm comment đọc êm hơn nhưng lại sai nghiệp vụ, phải ưu tiên **sửa nội dung đúng** trước; sự tự nhiên không thể bù cho một lời giải thích sai.
