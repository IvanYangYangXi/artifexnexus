// Copyright Artifex Nexus. All Rights Reserved.

#include "ArtifexNexusManageUtils.h"
#include "IPythonScriptPlugin.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "HAL/FileManager.h"

FString FArtifexNexusManageUtils::RunPythonAndCapture(const FString& PythonCode)
{
	FString TempDir = FPaths::ConvertRelativePathToFull(FPaths::ProjectSavedDir() / TEXT("ArtifexNexus"));
	IFileManager::Get().MakeDirectory(*TempDir, true);

	// Use GUID-based unique filenames to avoid race conditions with concurrent save operations
	FGuid UniqueId = FGuid::NewGuid();
	FString UniqueName = UniqueId.ToString(EGuidFormats::Digits);
	FString CaptureFile = TempDir / FString::Printf(TEXT("_py_result_%s.json"), *UniqueName);
	FString TempPyFile  = TempDir / FString::Printf(TEXT("_py_cmd_%s.py"),    *UniqueName);

	// Ensure both temp files will be cleaned up on function exit
	ON_SCOPE_EXIT
	{
		IFileManager::Get().Delete(*CaptureFile, false, false, true);
		IFileManager::Get().Delete(*TempPyFile,  false, false, true);
	};

	FString CleanScript;
	CleanScript += TEXT("import json, os\n");
	CleanScript += TEXT("_result = None\n");
	CleanScript += FString::Printf(TEXT("_capture_path = r'%s'\n"), *CaptureFile);
	CleanScript += TEXT("try:\n");

	TArray<FString> Lines;
	PythonCode.ParseIntoArrayLines(Lines);
	for (const FString& Line : Lines)
	{
		CleanScript += TEXT("    ") + Line + TEXT("\n");
	}

	CleanScript += TEXT("except Exception as _e:\n");
	CleanScript += TEXT("    _result = {'error': str(_e)}\n");
	CleanScript += TEXT("os.makedirs(os.path.dirname(_capture_path), exist_ok=True)\n");
	CleanScript += TEXT("with open(_capture_path, 'w', encoding='utf-8') as _f:\n");
	CleanScript += TEXT("    json.dump(_result if _result is not None else {}, _f, ensure_ascii=False)\n");

	FFileHelper::SaveStringToFile(CleanScript, *TempPyFile,
		FFileHelper::EEncodingOptions::ForceUTF8WithoutBOM);

	FString ExecCmd = FString::Printf(
		TEXT("exec(open(r'%s', encoding='utf-8').read())"), *TempPyFile);

	// Safety check: Python plugin may be unloaded during engine shutdown
	IPythonScriptPlugin* PythonPlugin = IPythonScriptPlugin::Get();
	if (!PythonPlugin || IsEngineExitRequested())
	{
		return TEXT("{}");
	}
	PythonPlugin->ExecPythonCommand(*ExecCmd);

	FString Result;
	if (FFileHelper::LoadFileToString(Result, *CaptureFile))
	{
		return Result;
	}
	return TEXT("{}");
}
