import { randomBytes } from "crypto";

/**
 * 범용적인 Client ID와 Client Secret을 생성합니다.
 * @returns { clientId: string, clientSecret: string }
 */
export function generateClientCredentials() {
    // Client ID: 16바이트 랜덤 값을 헥사 문자열로 변환 (총 32자)
    // UUID를 사용할 수도 있지만, 좀 더 커스텀한 느낌을 위해 헥사 사용
    const clientId = randomBytes(16).toString("hex");

    // Client Secret: 32바이트 랜덤 값을 헥사 문자열로 변환 (총 64자)
    // 보안을 위해 더 길고 복잡하게 생성
    const clientSecret = randomBytes(32).toString("hex");

    return {
        clientId,
        clientSecret,
    };
}

// 스크립트로 직접 실행 시 결과 출력
if (require.main === module) {
    const credentials = generateClientCredentials();
    console.log("=== New Client Credentials Generated ===");
    console.log(`Client ID:     ${credentials.clientId}`);
    console.log(`Client Secret: ${credentials.clientSecret}`);
    console.log("=========================================");
}
