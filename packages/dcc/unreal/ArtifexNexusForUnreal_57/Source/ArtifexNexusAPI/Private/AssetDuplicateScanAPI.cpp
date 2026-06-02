// Copyright ArtifexNexus. All Rights Reserved.

#include "AssetDuplicateScanAPI.h"

#include "Engine/StaticMesh.h"
#include "Engine/Texture2D.h"
#include "AssetRegistry/AssetRegistryModule.h"
#include "Misc/PackageName.h"
#include "Misc/SecureHash.h"
#include "HAL/FileManager.h"
#include "Materials/MaterialInterface.h"
#include "Math/Float16.h"
#include "StaticMeshResources.h"

// ──────────────────────────────────────────────────────────────────────────
//  Internal helpers
// ──────────────────────────────────────────────────────────────────────────
namespace ArtifexDupScanInternal
{
    /** FNV-1a hash */
    static uint32 HashBuffer(const uint8* Data, SIZE_T DataSize)
    {
        if (Data == nullptr || DataSize == 0) { return 0; }
        const uint32 FNV_Prime = 16777619u;
        uint32 Hash = 2166136261u;
        for (SIZE_T i = 0; i < DataSize; ++i)
        {
            Hash ^= Data[i];
            Hash *= FNV_Prime;
        }
        return Hash;
    }

    /** Get package file size on disk */
    static int64 GetPackageDiskSize(const UObject* Obj)
    {
        if (!Obj) { return 0; }
        const UPackage* Pkg = Obj->GetOutermost();
        if (!Pkg) { return 0; }
        FString Filename;
        if (FPackageName::DoesPackageExist(Pkg->GetName(), &Filename))
        {
            return IFileManager::Get().FileSize(*Filename);
        }
        return 0;
    }

    // ─── Mesh geometry fingerprint ───────────────────────────────────────

    struct FMeshFingerprint
    {
        FString AssetPath;
        FString AssetName;
        int64 DiskSize = 0;
        FString UniqueKey;
    };

    static FMeshFingerprint GetMeshFingerprint(UStaticMesh* Mesh)
    {
        FMeshFingerprint FP;
        if (!Mesh || !Mesh->GetRenderData() || Mesh->GetRenderData()->LODResources.Num() == 0)
        {
            return FP;
        }

        FP.AssetPath = Mesh->GetPathName();
        FP.AssetName = Mesh->GetName();
        FP.DiskSize = GetPackageDiskSize(Mesh);

        const FStaticMeshLODResources& LOD = Mesh->GetRenderData()->LODResources[0];
        const int32 VertexCount = LOD.GetNumVertices();
        const int32 TriangleCount = LOD.GetNumTriangles();
        if (VertexCount == 0) { return FP; }

        // Position hash
        uint32 VertexPositionHash = 0;
        {
            const FPositionVertexBuffer& PosBuf = LOD.VertexBuffers.PositionVertexBuffer;
            const uint8* PositionData = reinterpret_cast<const uint8*>(PosBuf.GetVertexData());
            const SIZE_T PositionDataSize = (SIZE_T)VertexCount * (SIZE_T)PosBuf.GetStride();
            VertexPositionHash = HashBuffer(PositionData, PositionDataSize);
        }

        // Index hash
        uint32 TriangleIndexHash = 0;
        {
            const FRawStaticIndexBuffer& IdxBuf = LOD.IndexBuffer;
            const int32 IdxCount = IdxBuf.GetNumIndices();
            if (IdxCount > 0)
            {
                const void* IdxData = nullptr;
                SIZE_T IdxSize = 0;
                if (IdxBuf.Is32Bit())
                {
                    IdxData = IdxBuf.AccessStream32();
                    IdxSize = (SIZE_T)IdxCount * sizeof(uint32);
                }
                else
                {
                    IdxData = IdxBuf.AccessStream16();
                    IdxSize = (SIZE_T)IdxCount * sizeof(uint16);
                }
                if (IdxData)
                {
                    TriangleIndexHash = HashBuffer(reinterpret_cast<const uint8*>(IdxData), IdxSize);
                }
            }
        }

        // UV + Normal/Tangent hash
        uint32 UVHash = 0;
        {
            FStaticMeshVertexBuffer& VBuf = const_cast<FStaticMeshVertexBuffer&>(LOD.VertexBuffers.StaticMeshVertexBuffer);
            const uint32 NumTexCoords = VBuf.GetNumTexCoords();
            if (VertexCount > 0 && NumTexCoords > 0)
            {
                uint32 Combined = 0;
                const void* TangentData = VBuf.GetTangentData();
                if (TangentData)
                {
                    const SIZE_T TangentSize = (SIZE_T)VertexCount * (SIZE_T)sizeof(FPackedNormal) * 2;
                    Combined = HashBuffer(reinterpret_cast<const uint8*>(TangentData), TangentSize);
                }
                const void* TexCoordData = VBuf.GetTexCoordData();
                if (TexCoordData)
                {
                    const bool bFullPrec = VBuf.GetUseFullPrecisionUVs();
                    const SIZE_T UVStride = bFullPrec ? (SIZE_T)8 : (SIZE_T)4;
                    const SIZE_T UVSize = (SIZE_T)VertexCount * (SIZE_T)NumTexCoords * UVStride;
                    Combined = Combined * 31 + HashBuffer(reinterpret_cast<const uint8*>(TexCoordData), UVSize);
                }
                UVHash = Combined;
            }
        }

        // Material hash
        int32 MaterialSlotCount = 0;
        FString MaterialStr;
        {
            const TArray<FStaticMaterial>& Materials = Mesh->GetStaticMaterials();
            MaterialSlotCount = Materials.Num();
            TArray<FString> MaterialPaths;
            MaterialPaths.Reserve(Materials.Num());
            for (const FStaticMaterial& Mat : Materials)
            {
                if (Mat.MaterialInterface)
                    MaterialPaths.Add(Mat.MaterialInterface->GetPathName());
                else
                    MaterialPaths.Add(Mat.MaterialSlotName.ToString());
            }
            if (MaterialPaths.Num() > 0)
            {
                const FString Combined = FString::Join(MaterialPaths, TEXT("|"));
                MaterialStr = FString::Printf(TEXT("_Mat%u"), GetTypeHash(Combined));
            }
            else
            {
                MaterialStr = TEXT("_Mat0");
            }
        }

        // Bounds
        const FBox Box = Mesh->GetBoundingBox();
        const FVector Ext = Box.GetExtent();
        const FString BoundsStr = FString::Printf(TEXT("%.2f_%.2f_%.2f"), Ext.X, Ext.Y, Ext.Z);

        // Composite key
        FP.UniqueKey = FString::Printf(TEXT("V%d_T%d_M%d%s_B%s_VP%u_TI%u_UV%u"),
            VertexCount, TriangleCount, MaterialSlotCount, *MaterialStr, *BoundsStr,
            VertexPositionHash, TriangleIndexHash, UVHash);

        return FP;
    }

    // ─── Texture helpers ─────────────────────────────────────────────────

    static FORCEINLINE void WriteRGBA(TArray<uint8>& Out, int64 Idx, uint8 R, uint8 G, uint8 B, uint8 A)
    {
        const int64 O = Idx * 4;
        Out[O] = R; Out[O + 1] = G; Out[O + 2] = B; Out[O + 3] = A;
    }

    /** Decode texture top MIP to RGBA8 */
    static bool BuildTopMipRGBA8(UTexture2D* Texture, TArray<uint8>& OutRGBA8, int32& OutW, int32& OutH)
    {
#if WITH_EDITOR
        if (!Texture) { return false; }
        FTextureSource& Source = Texture->Source;
        if (!Source.IsValid() || Source.GetNumMips() <= 0) { return false; }
        if (Source.GetSizeX() <= 0 || Source.GetSizeY() <= 0) { return false; }

        const ETextureSourceFormat SrcFmt = Source.GetFormat();
        if (SrcFmt == TSF_Invalid) { return false; }
        const int32 BytesPerPixel = Source.GetBytesPerPixel();
        if (BytesPerPixel <= 0) { return false; }

        OutW = Source.GetSizeX();
        OutH = Source.GetSizeY();
        const int64 NumPixels = (int64)OutW * (int64)OutH;

        TArray64<uint8> MipData;
        if (!Source.GetMipData(MipData, 0) || MipData.Num() == 0) { return false; }
        if ((int64)MipData.Num() < NumPixels * (int64)BytesPerPixel) { return false; }

        OutRGBA8.SetNumZeroed(NumPixels * 4);

        switch (SrcFmt)
        {
        case TSF_BGRA8:
        case TSF_BGRE8:
            for (int64 i = 0; i < NumPixels; ++i)
            {
                const uint8* P = &MipData[i * BytesPerPixel];
                WriteRGBA(OutRGBA8, i, P[2], P[1], P[0], P[3]);
            }
            break;
        case TSF_RGBA16:
            for (int64 i = 0; i < NumPixels; ++i)
            {
                const uint16* P = reinterpret_cast<const uint16*>(&MipData[i * BytesPerPixel]);
                WriteRGBA(OutRGBA8, i, (uint8)(P[0] >> 8), (uint8)(P[1] >> 8), (uint8)(P[2] >> 8), (uint8)(P[3] >> 8));
            }
            break;
        case TSF_RGBA16F:
            for (int64 i = 0; i < NumPixels; ++i)
            {
                const uint16* P = reinterpret_cast<const uint16*>(&MipData[i * BytesPerPixel]);
                FFloat16 R16, G16, B16, A16;
                R16.Encoded = P[0]; G16.Encoded = P[1]; B16.Encoded = P[2]; A16.Encoded = P[3];
                auto ToU8 = [](float V) -> uint8 { return (uint8)FMath::RoundToInt(FMath::Clamp(V, 0.f, 1.f) * 255.f); };
                WriteRGBA(OutRGBA8, i, ToU8((float)R16), ToU8((float)G16), ToU8((float)B16), ToU8((float)A16));
            }
            break;
        case TSF_G8:
            for (int64 i = 0; i < NumPixels; ++i)
            {
                const uint8 G = MipData[i];
                WriteRGBA(OutRGBA8, i, G, G, G, 255);
            }
            break;
        case TSF_G16:
            for (int64 i = 0; i < NumPixels; ++i)
            {
                const uint8 G = (uint8)(reinterpret_cast<const uint16*>(MipData.GetData())[i] >> 8);
                WriteRGBA(OutRGBA8, i, G, G, G, 255);
            }
            break;
        default:
            return false;
        }
        return true;
#else
        return false;
#endif
    }

    /** Compute MD5 hex of top MIP raw bytes */
    static FString ComputeTopMipMD5(UTexture2D* Texture)
    {
#if WITH_EDITOR
        if (!Texture) { return FString(); }
        FTextureSource& Source = Texture->Source;
        if (!Source.IsValid() || Source.GetNumMips() <= 0) { return FString(); }

        TArray64<uint8> RawTop;
        if (Source.GetMipData(RawTop, 0) && RawTop.Num() > 0)
        {
            uint8 Digest[16];
            FMD5 Md5;
            Md5.Update(RawTop.GetData(), RawTop.Num());
            Md5.Final(Digest);
            static const TCHAR* Hex = TEXT("0123456789abcdef");
            FString Out; Out.Reserve(32);
            for (int i = 0; i < 16; ++i)
            {
                Out += Hex[(Digest[i] >> 4) & 0xF];
                Out += Hex[Digest[i] & 0xF];
            }
            return Out;
        }
#endif
        return FString();
    }

    /** Extract type suffix like _D, _N from asset name */
    static FString ExtractTypeSuffix(const FString& Name)
    {
        int32 UndIdx = INDEX_NONE;
        if (Name.FindLastChar(TEXT('_'), UndIdx) && UndIdx >= 0 && UndIdx + 2 == Name.Len())
        {
            const TCHAR C = Name[UndIdx + 1];
            if (FChar::IsAlpha(C) || FChar::IsDigit(C))
            {
                return FString::Printf(TEXT("_%c"), (TCHAR)FChar::ToUpper(C));
            }
        }
        return FString();
    }

    /** Check if RGBA8 image is nearly monochrome (stddev < tolerance) */
    static bool IsMonochromeGray(const TArray<uint8>& RGBA8, int32 W, int32 H, float Tolerance = 1.0f)
    {
        const int64 NumPixels = (int64)W * (int64)H;
        if (NumPixels == 0 || RGBA8.Num() < NumPixels * 4) { return false; }
        double Sum = 0.0;
        for (int64 i = 0; i < NumPixels; ++i)
        {
            Sum += 0.299 * RGBA8[i * 4] + 0.587 * RGBA8[i * 4 + 1] + 0.114 * RGBA8[i * 4 + 2];
        }
        const double Mean = Sum / (double)NumPixels;
        double SumSq = 0.0;
        for (int64 i = 0; i < NumPixels; ++i)
        {
            const double G = 0.299 * RGBA8[i * 4] + 0.587 * RGBA8[i * 4 + 1] + 0.114 * RGBA8[i * 4 + 2];
            SumSq += (G - Mean) * (G - Mean);
        }
        return FMath::Sqrt(SumSq / (double)NumPixels) < (double)Tolerance;
    }

    /** Grayscale conversion */
    static void Grayscale(const TArray<uint8>& RGBA8, int32 W, int32 H, TArray<float>& OutGray)
    {
        OutGray.SetNumUninitialized(W * H);
        for (int32 i = 0; i < W * H; ++i)
        {
            OutGray[i] = 0.299f * RGBA8[i * 4] + 0.587f * RGBA8[i * 4 + 1] + 0.114f * RGBA8[i * 4 + 2];
        }
    }

    /** Nearest-neighbor resize */
    static void ResizeNearest(const TArray<float>& Src, int32 SrcW, int32 SrcH, int32 DstW, int32 DstH, TArray<float>& Dst)
    {
        Dst.SetNumUninitialized(DstW * DstH);
        for (int32 y = 0; y < DstH; ++y)
        {
            const int32 sy = FMath::Clamp((int32)((y + 0.5f) * SrcH / (float)DstH), 0, SrcH - 1);
            for (int32 x = 0; x < DstW; ++x)
            {
                const int32 sx = FMath::Clamp((int32)((x + 0.5f) * SrcW / (float)DstW), 0, SrcW - 1);
                Dst[y * DstW + x] = Src[sy * SrcW + sx];
            }
        }
    }

    /** Sobel edge + aHash → 64-bit */
    static uint64 ComputeEdgeHash64(const TArray<uint8>& RGBA8, int32 W, int32 H)
    {
        if (W <= 1 || H <= 1) { return 0; }
        TArray<float> Gray; Grayscale(RGBA8, W, H, Gray);

        TArray<float> Mag; Mag.SetNumZeroed(W * H);
        auto Get = [&](int32 xi, int32 yi) -> float
        {
            return Gray[FMath::Clamp(yi, 0, H - 1) * W + FMath::Clamp(xi, 0, W - 1)];
        };
        for (int32 y = 0; y < H; ++y)
        {
            for (int32 x = 0; x < W; ++x)
            {
                float gx = -Get(x - 1, y - 1) + Get(x + 1, y - 1) - 2 * Get(x - 1, y) + 2 * Get(x + 1, y) - Get(x - 1, y + 1) + Get(x + 1, y + 1);
                float gy = -Get(x - 1, y - 1) - 2 * Get(x, y - 1) - Get(x + 1, y - 1) + Get(x - 1, y + 1) + 2 * Get(x, y + 1) + Get(x + 1, y + 1);
                Mag[y * W + x] = FMath::Abs(gx) + FMath::Abs(gy);
            }
        }

        float Samples[64]; int32 idx = 0;
        for (int32 by = 0; by < 8; ++by)
            for (int32 bx = 0; bx < 8; ++bx)
                Samples[idx++] = Mag[FMath::Clamp((int32)((by + 0.5f) * H / 8.0f), 0, H - 1) * W + FMath::Clamp((int32)((bx + 0.5f) * W / 8.0f), 0, W - 1)];

        float Mean = 0; for (int i = 0; i < 64; ++i) Mean += Samples[i]; Mean /= 64.0f;
        uint64 Bits = 0;
        for (int i = 0; i < 64; ++i) if (Samples[i] >= Mean) Bits |= (uint64(1) << i);
        return Bits;
    }

    /** dHash 8x9 → 64-bit */
    static uint64 ComputeDiffHash64(const TArray<uint8>& RGBA8, int32 W, int32 H)
    {
        if (W <= 1 || H <= 1) { return 0; }
        TArray<float> Gray; Grayscale(RGBA8, W, H, Gray);
        TArray<float> Small; ResizeNearest(Gray, W, H, 9, 8, Small);

        uint64 Bits = 0; int32 BitIdx = 0;
        for (int32 y = 0; y < 8; ++y)
            for (int32 x = 0; x < 8; ++x)
            {
                if (Small[y * 9 + x] > Small[y * 9 + x + 1]) Bits |= (uint64(1) << BitIdx);
                ++BitIdx;
            }
        return Bits;
    }

    /** pHash DCT 32x32 → 64-bit */
    static uint64 ComputePerceptualHash64(const TArray<uint8>& RGBA8, int32 W, int32 H)
    {
        if (W <= 1 || H <= 1) { return 0; }
        const int32 N = 32;
        TArray<float> Gray; Grayscale(RGBA8, W, H, Gray);
        TArray<float> Small; ResizeNearest(Gray, W, H, N, N, Small);

        // Pre-compute DCT cosine table
        static float CosTable[32][32];
        static bool bInit = false;
        if (!bInit)
        {
            for (int u = 0; u < N; ++u)
                for (int x = 0; x < N; ++x)
                    CosTable[u][x] = FMath::Cos(((2.0f * x + 1.0f) * u * PI) / (2.0f * N));
            bInit = true;
        }

        const int32 K = 8;
        float DCT[8][8];
        for (int u = 0; u < K; ++u)
            for (int v = 0; v < K; ++v)
            {
                float Sum = 0;
                for (int x = 0; x < N; ++x)
                    for (int y = 0; y < N; ++y)
                        Sum += Small[y * N + x] * CosTable[u][x] * CosTable[v][y];
                DCT[u][v] = Sum;
            }

        float Coeffs[64]; int idx = 0;
        for (int u = 0; u < K; ++u)
            for (int v = 0; v < K; ++v)
                Coeffs[idx++] = DCT[u][v];

        // Median
        float Sorted[64]; FMemory::Memcpy(Sorted, Coeffs, sizeof(Sorted));
        for (int i = 1; i < 64; ++i)
        {
            float Key = Sorted[i]; int j = i - 1;
            while (j >= 0 && Sorted[j] > Key) { Sorted[j + 1] = Sorted[j]; --j; }
            Sorted[j + 1] = Key;
        }
        const float Median = 0.5f * (Sorted[31] + Sorted[32]);

        uint64 Bits = 0;
        for (int i = 0; i < 64; ++i)
            if (Coeffs[i] > Median) Bits |= (uint64(1) << i);
        return Bits;
    }

    static int32 HammingDistance64(uint64 A, uint64 B)
    {
        uint64 X = A ^ B; int32 C = 0;
        while (X) { X &= (X - 1); ++C; }
        return C;
    }

    /** Build result info from internal groups data */
    static void FillResultStats(FDuplicateScanResultInfo& Result)
    {
        Result.TotalDuplicateAssets = 0;
        Result.EstimatedRedundantBytes = 0;
        for (FDuplicateGroupInfo& G : Result.Groups)
        {
            Result.TotalDuplicateAssets += G.Members.Num();
            // Redundant = total - largest
            int64 Total = 0, Largest = 0;
            for (const FDuplicateAssetInfo& M : G.Members)
            {
                Total += M.DiskSizeBytes;
                if (M.DiskSizeBytes > Largest) Largest = M.DiskSizeBytes;
            }
            G.EstimatedRedundantBytes = Total - Largest;
            Result.EstimatedRedundantBytes += G.EstimatedRedundantBytes;
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
//  Public API implementations
// ──────────────────────────────────────────────────────────────────────────

FDuplicateScanResultInfo UAssetDuplicateScanAPI::ScanDuplicateMeshes(const FString& SearchPath, bool bRecursive)
{
    using namespace ArtifexDupScanInternal;
    FDuplicateScanResultInfo Result;

    // Enumerate StaticMesh assets
    FAssetRegistryModule& ARModule = FModuleManager::LoadModuleChecked<FAssetRegistryModule>("AssetRegistry");
    IAssetRegistry& AR = ARModule.Get();

    FARFilter Filter;
    Filter.ClassPaths.Add(UStaticMesh::StaticClass()->GetClassPathName());
    Filter.PackagePaths.Add(*SearchPath);
    Filter.bRecursivePaths = bRecursive;
    Filter.bRecursiveClasses = false;

    TArray<FAssetData> AssetDatas;
    AR.GetAssets(Filter, AssetDatas);

    // Process in batches with GC
    const int32 BatchSize = 64;
    TMap<FString, TArray<FDuplicateAssetInfo>> Buckets;

    for (int32 i = 0; i < AssetDatas.Num(); ++i)
    {
        UStaticMesh* Mesh = Cast<UStaticMesh>(AssetDatas[i].GetAsset());
        if (!Mesh) { ++Result.SkippedCount; continue; }

        FMeshFingerprint FP = GetMeshFingerprint(Mesh);
        if (FP.UniqueKey.IsEmpty()) { ++Result.SkippedCount; continue; }

        FDuplicateAssetInfo Info;
        Info.AssetPath = FP.AssetPath;
        Info.AssetName = FP.AssetName;
        Info.DiskSizeBytes = FP.DiskSize;
        Buckets.FindOrAdd(FP.UniqueKey).Add(Info);

        // Periodic GC to avoid OOM
        if ((i + 1) % BatchSize == 0)
        {
            CollectGarbage(GARBAGE_COLLECTION_KEEPFLAGS);
        }
    }

    Result.TotalScanned = AssetDatas.Num();

    // Build groups
    for (auto& Pair : Buckets)
    {
        if (Pair.Value.Num() < 2) continue;
        FDuplicateGroupInfo Group;
        Group.GroupSignature = Pair.Key;
        Group.Members = MoveTemp(Pair.Value);
        Result.Groups.Add(MoveTemp(Group));
    }

    FillResultStats(Result);
    return Result;
}

FDuplicateScanResultInfo UAssetDuplicateScanAPI::ScanIdenticalTextures(const FString& SearchPath, bool bRecursive, bool bRespectTypeSuffix)
{
    using namespace ArtifexDupScanInternal;
    FDuplicateScanResultInfo Result;

    FAssetRegistryModule& ARModule = FModuleManager::LoadModuleChecked<FAssetRegistryModule>("AssetRegistry");
    IAssetRegistry& AR = ARModule.Get();

    FARFilter Filter;
    Filter.ClassPaths.Add(UTexture2D::StaticClass()->GetClassPathName());
    Filter.PackagePaths.Add(*SearchPath);
    Filter.bRecursivePaths = bRecursive;
    Filter.bRecursiveClasses = false;

    TArray<FAssetData> AssetDatas;
    AR.GetAssets(Filter, AssetDatas);

    const int32 BatchSize = 64;
    TMap<FString, TArray<FDuplicateAssetInfo>> Buckets;

    for (int32 i = 0; i < AssetDatas.Num(); ++i)
    {
        UTexture2D* Tex = Cast<UTexture2D>(AssetDatas[i].GetAsset());
        if (!Tex) { ++Result.SkippedCount; continue; }

        FString MD5 = ComputeTopMipMD5(Tex);
        if (MD5.IsEmpty()) { ++Result.SkippedCount; continue; }

        const FString TypeSuffix = bRespectTypeSuffix ? ExtractTypeSuffix(Tex->GetName()) : TEXT("");
        const FString Key = FString::Printf(TEXT("%s|%s"), *TypeSuffix, *MD5);

        FDuplicateAssetInfo Info;
        Info.AssetPath = Tex->GetPathName();
        Info.AssetName = Tex->GetName();
        Info.DiskSizeBytes = GetPackageDiskSize(Tex);
        Buckets.FindOrAdd(Key).Add(Info);

        if ((i + 1) % BatchSize == 0)
        {
            CollectGarbage(GARBAGE_COLLECTION_KEEPFLAGS);
        }
    }

    Result.TotalScanned = AssetDatas.Num();

    for (auto& Pair : Buckets)
    {
        if (Pair.Value.Num() < 2) continue;
        FDuplicateGroupInfo Group;
        Group.GroupSignature = Pair.Key;
        Group.Members = MoveTemp(Pair.Value);
        Result.Groups.Add(MoveTemp(Group));
    }

    FillResultStats(Result);
    return Result;
}

FDuplicateScanResultInfo UAssetDuplicateScanAPI::ScanSimilarTextures(
    const FString& SearchPath, bool bRecursive,
    EPerceptualHashAlgorithm Algorithm, int32 HammingThreshold, bool bRespectTypeSuffix)
{
    using namespace ArtifexDupScanInternal;
    FDuplicateScanResultInfo Result;
    HammingThreshold = FMath::Clamp(HammingThreshold, 0, 64);

    FAssetRegistryModule& ARModule = FModuleManager::LoadModuleChecked<FAssetRegistryModule>("AssetRegistry");
    IAssetRegistry& AR = ARModule.Get();

    FARFilter Filter;
    Filter.ClassPaths.Add(UTexture2D::StaticClass()->GetClassPathName());
    Filter.PackagePaths.Add(*SearchPath);
    Filter.bRecursivePaths = bRecursive;
    Filter.bRecursiveClasses = false;

    TArray<FAssetData> AssetDatas;
    AR.GetAssets(Filter, AssetDatas);

    // Fingerprint each texture
    struct FTexFP
    {
        FDuplicateAssetInfo Info;
        uint64 Hash64 = 0;
        FString TypeSuffix;
        bool bInvalid = false;
    };

    TArray<FTexFP> FPs;
    FPs.Reserve(AssetDatas.Num());
    const int32 BatchSize = 64;

    for (int32 i = 0; i < AssetDatas.Num(); ++i)
    {
        UTexture2D* Tex = Cast<UTexture2D>(AssetDatas[i].GetAsset());
        if (!Tex) { ++Result.SkippedCount; continue; }

        FTexFP FP;
        FP.Info.AssetPath = Tex->GetPathName();
        FP.Info.AssetName = Tex->GetName();
        FP.Info.DiskSizeBytes = GetPackageDiskSize(Tex);
        FP.TypeSuffix = ExtractTypeSuffix(Tex->GetName());

        TArray<uint8> RGBA8; int32 W = 0, H = 0;
        if (!BuildTopMipRGBA8(Tex, RGBA8, W, H) || RGBA8.Num() == 0)
        {
            FP.bInvalid = true;
            ++Result.SkippedCount;
        }
        else if (IsMonochromeGray(RGBA8, W, H))
        {
            FP.bInvalid = true;
        }
        else
        {
            switch (Algorithm)
            {
            case EPerceptualHashAlgorithm::SobelAHash:
                FP.Hash64 = ComputeEdgeHash64(RGBA8, W, H); break;
            case EPerceptualHashAlgorithm::DiffHash:
                FP.Hash64 = ComputeDiffHash64(RGBA8, W, H); break;
            case EPerceptualHashAlgorithm::PerceptualHash:
                FP.Hash64 = ComputePerceptualHash64(RGBA8, W, H); break;
            }
            if (FP.Hash64 == 0 || FP.Hash64 == UINT64_MAX) FP.bInvalid = true;
        }
        FPs.Add(MoveTemp(FP));

        if ((i + 1) % BatchSize == 0)
        {
            CollectGarbage(GARBAGE_COLLECTION_KEEPFLAGS);
        }
    }

    Result.TotalScanned = AssetDatas.Num();

    // Union-Find clustering
    const int32 N = FPs.Num();
    TArray<int32> Parent; Parent.SetNumUninitialized(N);
    for (int32 i = 0; i < N; ++i) Parent[i] = i;

    auto Find = [&Parent](int32 X) -> int32
    {
        while (Parent[X] != X) { Parent[X] = Parent[Parent[X]]; X = Parent[X]; }
        return X;
    };
    auto Union = [&](int32 A, int32 B)
    {
        int32 RA = Find(A), RB = Find(B);
        if (RA != RB) Parent[RA] = RB;
    };

    for (int32 i = 0; i < N; ++i)
    {
        if (FPs[i].bInvalid) continue;
        for (int32 j = i + 1; j < N; ++j)
        {
            if (FPs[j].bInvalid) continue;
            if (bRespectTypeSuffix && FPs[i].TypeSuffix != FPs[j].TypeSuffix) continue;
            if (HammingDistance64(FPs[i].Hash64, FPs[j].Hash64) <= HammingThreshold)
            {
                Union(i, j);
            }
        }
    }

    // Build groups from Union-Find
    TMap<int32, FDuplicateGroupInfo> RootToGroup;
    for (int32 i = 0; i < N; ++i)
    {
        if (FPs[i].bInvalid) continue;
        const int32 R = Find(i);
        FDuplicateGroupInfo& G = RootToGroup.FindOrAdd(R);
        G.Members.Add(FPs[i].Info);
    }

    for (auto& Pair : RootToGroup)
    {
        FDuplicateGroupInfo& G = Pair.Value;
        if (G.Members.Num() < 2) continue;

        // Calculate hamming distances to representative (first member)
        int32 RepIdx = -1;
        for (int32 i = 0; i < N; ++i)
        {
            if (!FPs[i].bInvalid && FPs[i].Info.AssetPath == G.Members[0].AssetPath)
            { RepIdx = i; break; }
        }
        if (RepIdx >= 0)
        {
            int32 MaxD = 0;
            for (int32 m = 1; m < G.Members.Num(); ++m)
            {
                for (int32 i = 0; i < N; ++i)
                {
                    if (!FPs[i].bInvalid && FPs[i].Info.AssetPath == G.Members[m].AssetPath)
                    {
                        int32 D = HammingDistance64(FPs[RepIdx].Hash64, FPs[i].Hash64);
                        G.Members[m].DistanceToRepresentative = D;
                        MaxD = FMath::Max(MaxD, D);
                        break;
                    }
                }
            }
            G.MaxHammingDistance = MaxD;
        }

        G.GroupSignature = FString::Printf(TEXT("%llx"), RepIdx >= 0 ? FPs[RepIdx].Hash64 : 0ull);
        Result.Groups.Add(MoveTemp(G));
    }

    FillResultStats(Result);
    return Result;
}
